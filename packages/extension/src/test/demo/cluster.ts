// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Off-camera cluster access for scene `setup` hooks: reset what a scene
 * creates or changes through the OpenChoreo API with the demo occ login.
 * Works wherever the scenes run (a headless Linux box or a Mac), so never
 * use kubectl or ssh in scenes.
 *
 *   OCC_CONFIG  occ config with the login (default ~/.openchoreo/config)
 *   DEMO_OCC    occ binary (default `occ` on PATH)
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse } from 'yaml';

interface OccConfig {
  currentContext?: string;
  controlplanes?: { name: string; url: string }[];
  credentials?: { name: string; clientId?: string; clientSecret?: string; token?: string; authMethod?: string }[];
  contexts?: { name: string; controlplane?: string; credentials?: string; namespace?: string; project?: string }[];
}

export function occConfigPath(): string {
  return process.env.OCC_CONFIG ?? path.join(os.homedir(), '.openchoreo', 'config');
}

function session() {
  const config = parse(fs.readFileSync(occConfigPath(), 'utf8')) as OccConfig;
  const context = config.contexts?.find((c) => c.name === config.currentContext) ?? config.contexts?.[0];
  const plane = config.controlplanes?.find((p) => p.name === context?.controlplane) ?? config.controlplanes?.[0];
  const credentials = config.credentials?.find((c) => c.name === context?.credentials) ?? config.credentials?.[0];
  if (!plane) throw new Error(`no control plane in ${occConfigPath()}`);
  return { url: plane.url.replace(/\/$/, ''), namespace: context?.namespace ?? 'default', project: context?.project, credentials };
}

/** The current context's namespace and project. */
export function occContext(): { namespace: string; project?: string } {
  const { namespace, project } = session();
  return { namespace, project };
}

/** Run occ with the demo login (its own HOME, so the real ~/.openchoreo is never touched). Returns stdout. */
export function occ(args: string[], options: { cwd?: string; allowFailure?: boolean } = {}): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-demo-occ-'));
  try {
    fs.mkdirSync(path.join(home, '.openchoreo'));
    fs.copyFileSync(occConfigPath(), path.join(home, '.openchoreo', 'config'));
    return execFileSync(process.env.DEMO_OCC ?? 'occ', args, {
      cwd: options.cwd,
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (options.allowFailure) return '';
    const e = err as { stderr?: string; message: string };
    throw new Error(`occ ${args.join(' ')}: ${e.stderr || e.message}`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

let cachedToken: { value: string; expires: number } | undefined;

async function token(): Promise<string | undefined> {
  const { url, credentials } = session();
  if (!credentials) return undefined;
  if (cachedToken && cachedToken.expires > Date.now() + 30_000) return cachedToken.value;
  if (credentials.authMethod === 'client_credentials' && credentials.clientId && credentials.clientSecret) {
    const resource = await (await fetch(`${url}/.well-known/oauth-protected-resource`)).json() as { authorization_servers?: string[] };
    const issuer = resource.authorization_servers?.[0];
    if (!issuer) throw new Error('control plane advertises no authorization server');
    const oidc = await (await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`)).json() as { token_endpoint: string };
    const res = await fetch(oidc.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: credentials.clientId, client_secret: credentials.clientSecret }),
    });
    if (!res.ok) throw new Error(`token request failed: ${res.status} ${await res.text()}`);
    const body = await res.json() as { access_token: string; expires_in?: number };
    cachedToken = { value: body.access_token, expires: Date.now() + (body.expires_in ?? 300) * 1000 };
    return cachedToken.value;
  }
  return credentials.token;
}

/**
 * Call the OpenChoreo API, e.g. `api('DELETE', '/api/v1/namespaces/default/components/notification-service')`.
 * Returns the status and parsed body; never throws on HTTP errors (check `status`).
 */
export async function api(method: string, route: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const { url } = session();
  const bearer = await token();
  const res = await fetch(`${url}${route}`, {
    method,
    headers: {
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    // not JSON
  }
  return { status: res.status, json };
}

/** Poll until `check` returns true (off camera), or throw after `timeoutMs`. */
export async function until(check: () => Promise<boolean> | boolean, timeoutMs = 60_000, intervalMs = 1500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`condition not met within ${timeoutMs} ms`);
}

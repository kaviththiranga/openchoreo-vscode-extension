// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Off-camera access to the url-shortener's services through `occ remote`, for
 * scene setups: seed the links snip-digest reports and make fresh runtime logs. Uses the demo login (OCC_CONFIG) and DEMO_OCC like ../../cluster.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { occConfigPath } from '../../cluster';

/** Open tunnels for a workload, run `fn` with the resolved bindings, then close them. */
export async function withTunnels<T>(
  workload: string,
  environment: string,
  fn: (env: Record<string, string>) => Promise<T>,
): Promise<T> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-demo-remote-'));
  fs.mkdirSync(path.join(home, '.openchoreo'));
  fs.copyFileSync(occConfigPath(), path.join(home, '.openchoreo', 'config'));
  const child = spawn(
    process.env.DEMO_OCC ?? 'occ',
    ['remote', path.basename(workload), '--env', environment, '--print-env', '--no-secrets'],
    { cwd: path.dirname(workload), env: { ...process.env, HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  try {
    const env = await new Promise<Record<string, string>>((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error(`occ remote did not open tunnels: ${out}`)), 60_000);
      const onData = (chunk: Buffer) => {
        out += String(chunk);
        if (!out.includes('Tunnels open.')) return;
        clearTimeout(timer);
        const bindings: Record<string, string> = {};
        for (const m of out.matchAll(/^\s*export ([A-Za-z_][A-Za-z0-9_]*)=(.*)$/gm)) bindings[m[1]] = m[2];
        resolve(bindings);
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`occ remote exited with ${code}: ${out}`));
      });
    });
    return await fn(env);
  } finally {
    child.kill('SIGINT');
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (child.exitCode === null) child.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
}

/** The team whose links snip-digest reports, and its short links with how often each was opened. */
const TEAM = 'devrel';
const LINKS: { slug: string; url: string; clicks: number }[] = [
  { slug: 'quickstart', url: 'https://openchoreo.dev/docs/getting-started/quick-start-guide/', clicks: 41 },
  { slug: 'release-notes', url: 'https://github.com/openchoreo/openchoreo/releases', clicks: 27 },
  { slug: 'gateway-api-guide', url: 'https://gateway-api.sigs.k8s.io/guides/', clicks: 16 },
  { slug: 'landscape', url: 'https://landscape.cncf.io/', clicks: 9 },
  { slug: 'backstage-intro', url: 'https://backstage.io/docs/overview/what-is-backstage', clicks: 5 },
  { slug: 'golang-blog', url: 'https://go.dev/blog/', clicks: 2 },
];

/**
 * Make sure the url-shortener in `environment` has the team's links, and touch
 * the API so its runtime logs have fresh lines. `workload` is a workload.yaml
 * that depends on snip-api-service and snip-analytics-service.
 */
export async function seedLinks(workload: string, environment: string): Promise<void> {
  await withTunnels(workload, environment, async (env) => {
    const api = env.API_SERVICE_URL;
    const analytics = env.ANALYTICS_SERVICE_URL;
    if (!api || !analytics) throw new Error(`missing bindings: ${Object.keys(env).join(', ')}`);
    const mine = (await (await fetch(`${analytics}/api/analytics/user/${TEAM}`)).json()) as { urls?: { short_code: string }[] };
    const have = new Set((mine.urls ?? []).map((u) => u.short_code));
    for (const link of LINKS) {
      if (have.has(link.slug)) continue;
      const res = await fetch(`${api}/api/shorten`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: link.url, username: TEAM, custom_slug: link.slug }),
      });
      if (!res.ok && res.status !== 409) throw new Error(`shorten ${link.slug}: ${res.status} ${await res.text()}`);
      for (let i = 0; i < link.clicks; i++) await fetch(`${api}/r/${link.slug}`, { redirect: 'manual' });
    }
    // Fresh redirect lines (people opening the team's links) for View Runtime Logs.
    for (const slug of ['quickstart', 'release-notes', 'quickstart', 'landscape']) {
      await fetch(`${api}/r/${slug}`, { redirect: 'manual' });
    }
  });
}

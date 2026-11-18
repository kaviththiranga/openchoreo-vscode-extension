// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Background `occ remote --print-env` sessions: local tunnels to an
 * environment's real dependencies, with the resolved bindings captured for a
 * debug session's environment. Values stay in memory and go only to the
 * process being debugged; nothing is printed or written to disk.
 */
import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { log } from '../logging/logger';
import { occEnv } from '../cli/cliPath';

const READY_TIMEOUT_MS = 90_000;
const BINDINGS_HEADER = 'Environment bindings:';
const OPEN_MARKER = 'Tunnels open.';

export interface TunnelOptions {
  /** Workload manifests (absolute paths). */
  workloads: string[];
  environment: string;
  namespace?: string;
  /** `--local component=host:port` wiring for components also running locally. */
  local?: Record<string, string>;
  /** Fetch Secret/ConfigMap-backed values (`--show-secrets`), or leave them unresolved (`--no-secrets`). */
  secrets: boolean;
  cwd: string;
}

export interface PrintEnvResult {
  env: Record<string, string>;
  /** Bindings whose values occ withheld. */
  hidden: string[];
  /** occ reported the tunnels open. */
  open: boolean;
}

/** Parse `occ remote --print-env` output (possibly partial). */
export function parsePrintEnv(output: string): PrintEnvResult {
  const result: PrintEnvResult = { env: {}, hidden: [], open: false };
  const lines = output.split(/\r?\n/);
  let inBindings = false;
  for (const line of lines) {
    if (line.trim() === BINDINGS_HEADER) {
      inBindings = true;
      continue;
    }
    if (line.startsWith(OPEN_MARKER)) {
      result.open = true;
      inBindings = false;
      continue;
    }
    if (!inBindings) continue;
    const m = /^\s*export ([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!m) continue;
    if (/^<hidden;/.test(m[2])) result.hidden.push(m[1]);
    else result.env[m[1]] = m[2];
  }
  return result;
}

export function remoteArgs(options: TunnelOptions): string[] {
  const args = ['remote', ...options.workloads.map((w) => path.relative(options.cwd, w) || '.'), '--env', options.environment];
  if (options.namespace) args.push('--namespace', options.namespace);
  for (const [component, address] of Object.entries(options.local ?? {})) args.push('--local', `${component}=${address}`);
  args.push('--print-env', options.secrets ? '--show-secrets' : '--no-secrets');
  return args;
}

export function tunnelKey(options: Pick<TunnelOptions, 'workloads' | 'environment' | 'namespace' | 'local'>): string {
  return JSON.stringify([
    [...options.workloads].sort(),
    options.environment,
    options.namespace ?? '',
    Object.entries(options.local ?? {}).sort(),
  ]);
}

export class TunnelSession implements vscode.Disposable {
  readonly ready: Promise<PrintEnvResult>;
  private child: ChildProcess | undefined;
  private output = '';
  private stopped = false;
  private readonly exited = new vscode.EventEmitter<void>();
  readonly onDidExit = this.exited.event;
  /** Debug sessions using these tunnels. */
  users = 0;

  constructor(
    readonly options: TunnelOptions,
    binary: string,
    private readonly channel: vscode.OutputChannel,
  ) {
    this.ready = new Promise((resolve, reject) => {
      const args = remoteArgs(options);
      channel.appendLine(`$ occ ${args.join(' ')}`);
      const child = spawn(binary, args, { cwd: options.cwd, env: occEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
      this.child = child;
      let stderr = '';
      const timer = setTimeout(() => {
        reject(new Error(`occ remote didn't open the tunnels within ${READY_TIMEOUT_MS / 1000}s. ${lastLine(stderr)}`));
        this.dispose();
      }, READY_TIMEOUT_MS);
      child.stdout?.on('data', (chunk: Buffer) => {
        this.output += String(chunk);
        const parsed = parsePrintEnv(this.output);
        // Log names only: the values can be credentials.
        if (parsed.open) {
          clearTimeout(timer);
          channel.appendLine(`Tunnels open for ${options.environment}: ${Object.keys(parsed.env).join(', ') || 'no bindings'}`);
          if (parsed.hidden.length) channel.appendLine(`Not resolved: ${parsed.hidden.join(', ')}`);
          resolve(parsed);
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += String(chunk);
        channel.append(String(chunk));
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        channel.appendLine(`occ remote exited${code === null ? '' : ` with ${code}`}.`);
        if (!this.stopped) reject(new Error(friendlyError(stderr) ?? `occ remote exited with ${code}. ${lastLine(stderr)}`));
        this.stopped = true;
        this.exited.fire();
      });
    });
    this.ready.catch(() => undefined);
  }

  get running(): boolean {
    return !this.stopped;
  }

  dispose(): void {
    if (this.stopped) return;
    this.stopped = true;
    // SIGINT lets occ close the tunnels and delete files it materialized.
    this.child?.kill(process.platform === 'win32' ? undefined : 'SIGINT');
    const child = this.child;
    setTimeout(() => child?.exitCode === null && child.kill(), 5_000);
  }
}

/** Turn occ's failure output into advice, for the failures the docs describe. */
export function friendlyError(stderr: string): string | undefined {
  if (/remote.?connect.*(disabled|not enabled)|remoteConnect/i.test(stderr)) {
    return 'Local development is not enabled on this control plane (openchoreoApi.config.remoteConnect.enabled). Ask your platform team.';
  }
  if (/router|dial/i.test(stderr) && /timeout|timed out|refused|unreachable/i.test(stderr)) {
    return "occ couldn't reach the environment's remote-agent router. The data plane may not have remoteAgentRouter.enabled; ask your platform team.";
  }
  if (/forbidden|permission|403/i.test(stderr)) {
    return "Your role doesn't allow connecting to one of the dependencies (component:connect / resource:connect).";
  }
  return undefined;
}

const lastLine = (text: string) => text.trim().split('\n').pop() ?? '';

export class TunnelManager implements vscode.Disposable {
  private readonly sessions = new Map<string, TunnelSession>();
  private readonly item = vscode.window.createStatusBarItem('openchoreo.tunnels', vscode.StatusBarAlignment.Left, 97);
  private readonly channel = vscode.window.createOutputChannel('OpenChoreo: Local Tunnels');

  constructor(private readonly resolveBinary: () => string) {
    this.item.name = 'OpenChoreo Tunnels';
    this.item.command = 'openchoreo.manageTunnels';
  }

  /** Reuse an open session for the same workloads and environment, or start one. */
  start(options: TunnelOptions): TunnelSession {
    const key = tunnelKey(options);
    const existing = this.sessions.get(key);
    if (existing?.running) return existing;
    const session = new TunnelSession(options, this.resolveBinary(), this.channel);
    this.sessions.set(key, session);
    session.onDidExit(() => {
      if (this.sessions.get(key) === session) this.sessions.delete(key);
      this.render();
    });
    session.ready.then(() => this.render(), () => this.render());
    this.render();
    return session;
  }

  list(): TunnelSession[] {
    return [...this.sessions.values()].filter((s) => s.running);
  }

  stop(session: TunnelSession): void {
    session.dispose();
    this.render();
  }

  showOutput(): void {
    this.channel.show(true);
  }

  private render(): void {
    const sessions = this.list();
    void vscode.commands.executeCommand('setContext', 'openchoreo.tunnelsOpen', sessions.length > 0);
    if (sessions.length === 0) {
      this.item.hide();
      return;
    }
    const envs = [...new Set(sessions.map((s) => s.options.environment))];
    this.item.text = `$(plug) ${envs.join(', ')}`;
    this.item.tooltip = sessions
      .map((s) => `${s.options.workloads.map((w) => path.basename(path.dirname(w))).join(', ')} → ${s.options.environment}`)
      .join('\n');
    this.item.show();
  }

  dispose(): void {
    this.sessions.forEach((s) => s.dispose());
    this.item.dispose();
    this.channel.dispose();
  }
}

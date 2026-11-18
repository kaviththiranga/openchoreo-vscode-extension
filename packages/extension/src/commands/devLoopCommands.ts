// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as path from 'path';
import * as vscode from 'vscode';
import { summarizeLogs } from '../ai/logSummary';
import {
  createObservabilityClientWithUrl,
  ObservabilityUrlResolver,
} from '@openchoreo/openchoreo-client-node';
import type { OccConfigAuthProvider } from '../auth/authProvider';
import type { ApiClientManager } from '../api/apiClient';
import type { LogOutputService } from '../services/logOutputService';
import type { ServerInfoService } from '../services/serverInfoService';
import type { ResourceNodeData } from '../treeView/types';
import { log } from '../logging/logger';

type Client = NonNullable<Awaited<ReturnType<ApiClientManager['getClient']>>>;

export interface DevLoopDeps {
  authProvider: OccConfigAuthProvider;
  apiClientManager: ApiClientManager;
  serverInfo: ServerInfoService;
  logOutputService: LogOutputService;
  resolveBinary: () => string;
  resolveNode: (arg: unknown) => ResourceNodeData | undefined;
}

/** Component coordinates plus the environment an action targets. */
interface Target {
  namespace: string;
  project: string;
  component: string;
  environment: string;
  releaseBinding?: string;
}

/**
 * Inner-loop commands on top of OpenChoreo 1.3: run a workload locally against
 * an environment's real dependencies (`occ remote`), open a shell in a running
 * pod (`occ component exec`), read runtime logs from the observer, and run a
 * scheduled task on demand.
 */
export function registerDevLoopCommands(context: vscode.ExtensionContext, deps: DevLoopDeps): void {
  const register = (id: string, fn: (...args: unknown[]) => Promise<void>) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (...args: unknown[]) => {
        try {
          await fn(...args);
        } catch (err) {
          log.error(`${id} failed`, err);
          vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
        }
      }),
    );

  register('openchoreo.openShell', async (arg) => {
    if (!requireServer(deps, 1, 3, 'Open Shell')) return;
    const target = await resolveTarget(deps, arg);
    if (!target) return;
    runInTerminal(`occ exec: ${target.component} (${target.environment})`, deps.resolveBinary(), [
      'component', 'exec', target.component,
      '--namespace', target.namespace,
      '--project', target.project,
      '--env', target.environment,
    ]);
  });

  register('openchoreo.runLocally', async (arg) => {
    if (!requireServer(deps, 1, 3, 'Run Locally')) return;
    const workloadUri = await resolveWorkloadUri(arg);
    if (!workloadUri) return;
    const client = await requireClient(deps);
    const namespace = deps.authProvider.getContextInfo()?.namespace ?? 'default';
    const environment = await pickEnvironment(client, namespace);
    if (!environment) return;

    const mode = await vscode.window.showQuickPick(
      [
        {
          label: 'Open a shell wired to the environment',
          description: 'Run your app from the shell; dependencies resolve to local tunnels',
          printEnv: false,
        },
        {
          label: 'Keep tunnels open and print the environment',
          description: 'Copy the variables into a debugger launch configuration',
          printEnv: true,
        },
      ],
      { placeHolder: `Run ${path.basename(workloadUri.fsPath)} against ${environment}` },
    );
    if (!mode) return;

    const folder = vscode.workspace.getWorkspaceFolder(workloadUri);
    const cwd = folder?.uri.fsPath ?? path.dirname(workloadUri.fsPath);
    const args = ['remote', path.relative(cwd, workloadUri.fsPath) || '.', '--env', environment, '--namespace', namespace];
    if (mode.printEnv) args.push('--print-env');
    runInTerminal(`occ remote (${environment})`, deps.resolveBinary(), args, cwd);
  });

  register('openchoreo.viewRuntimeLogs', async (arg) => {
    const target = await resolveTarget(deps, arg);
    if (!target) return;

    const range = await vscode.window.showQuickPick(
      [
        { label: 'Last 15 minutes', minutes: 15 },
        { label: 'Last hour', minutes: 60 },
        { label: 'Last 6 hours', minutes: 360 },
        { label: 'Last 24 hours', minutes: 1440 },
      ],
      { placeHolder: `Runtime logs for ${target.component} in ${target.environment}` },
    );
    if (!range) return;
    const searchPhrase = await vscode.window.showInputBox({
      prompt: 'Filter by text (optional)',
      placeHolder: 'e.g. timeout',
    });
    if (searchPhrase === undefined) return;

    const session = deps.authProvider.getSession();
    if (!session) throw new Error('Not connected to OpenChoreo. Run "occ login" first.');
    const token = session.securityEnabled ? await deps.authProvider.getToken() : undefined;

    const { observerUrl } = await new ObservabilityUrlResolver({
      baseUrl: session.controlPlaneUrl,
    }).resolveForEnvironment(target.namespace, target.environment, token);
    if (!observerUrl) {
      throw new Error(
        `Environment "${target.environment}" has no observability plane with an observer URL.`,
      );
    }

    const end = new Date();
    const start = new Date(end.getTime() - range.minutes * 60_000);
    const observer = createObservabilityClientWithUrl(observerUrl, token);
    const { data, error } = await observer.POST('/api/v1/logs/query', {
      body: {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        limit: 1000,
        sortOrder: 'asc',
        searchScope: {
          namespace: target.namespace,
          project: target.project,
          component: target.component,
          environment: target.environment,
        },
        ...(searchPhrase ? { searchPhrase } : {}),
      },
    });
    if (error) throw new Error(`Log query failed: ${JSON.stringify(error)}`);

    const entries = (data?.logs ?? []).map((e) => {
      const entry = e as { timestamp?: string; log?: string; level?: string; metadata?: { podName?: string } };
      const pod = entry.metadata?.podName ? `${entry.metadata.podName} ` : '';
      const level = entry.level ? `${entry.level} ` : '';
      return { timestamp: entry.timestamp, log: `${pod}${level}${entry.log ?? ''}` };
    });
    const channel = `OpenChoreo Logs: ${target.component} (${target.environment})`;
    deps.logOutputService.showLogs(channel, entries);
    if (entries.length === 0) {
      vscode.window.showInformationMessage(`No logs for ${target.component} in ${target.environment} in that window.`);
      return;
    }
    const truncated = (data?.total ?? 0) > entries.length;
    const choice = await vscode.window.showInformationMessage(
      truncated
        ? `Showing the first ${entries.length} of ${data?.total} matching lines.`
        : `Showing ${entries.length} log lines.`,
      'Summarize with Copilot',
    );
    if (choice === 'Summarize with Copilot') {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Summarizing logs…', cancellable: true },
        (_progress, token) =>
          summarizeLogs(
            `component ${target.component} in environment ${target.environment}`,
            entries.map((e) => `${e.timestamp ?? ''} ${e.log}`),
            (text) => deps.logOutputService.append(channel, text),
            token,
          ),
      );
    }
  });

  register('openchoreo.runScheduledTaskNow', async (arg) => {
    if (!requireServer(deps, 1, 3, 'Run Now')) return;
    const node = deps.resolveNode(arg);
    if (!node?.resourceName || node.type !== 'release-binding' || !node.namespace) return;
    const session = deps.authProvider.getSession();
    if (!session) throw new Error('Not connected to OpenChoreo. Run "occ login" first.');
    const token = session.securityEnabled ? await deps.authProvider.getToken() : undefined;

    // Not in the published client yet, so call the route directly.
    const url = `${session.controlPlaneUrl}/api/v1alpha1/namespaces/${encodeURIComponent(node.namespace)}/releasebindings/${encodeURIComponent(node.resourceName)}/trigger`;
    const res = await fetch(url, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    // CronJobTriggerResponse { jobName, namespace, cronJobName } / ErrorResponse { error, code }
    const body = (await res.json().catch(() => ({}))) as { jobName?: string; error?: string };
    if (!res.ok) {
      throw new Error(`Run Now failed: ${body.error ?? res.statusText}`);
    }
    vscode.window.showInformationMessage(
      `Started job ${body.jobName ?? '(unnamed)'} for ${node.component ?? node.resourceName}.`,
    );
  });
}

function requireServer(deps: DevLoopDeps, major: number, minor: number, feature: string): boolean {
  // Unknown version: let the CLI/API answer rather than block.
  if (deps.serverInfo.supports(major, minor, true)) return true;
  vscode.window.showWarningMessage(
    `${feature} needs OpenChoreo ${major}.${minor} or later (connected: ${deps.serverInfo.getVersion()?.raw ?? 'unknown'}).`,
  );
  return false;
}

async function requireClient(deps: DevLoopDeps): Promise<Client> {
  const client = await deps.apiClientManager.getClient();
  if (!client) throw new Error('Not connected to OpenChoreo. Run "occ login" first.');
  return client;
}

/**
 * Component + environment from a tree node: a release binding carries its
 * environment; a component asks which deployed environment to use.
 */
async function resolveTarget(deps: DevLoopDeps, arg: unknown): Promise<Target | undefined> {
  const node = deps.resolveNode(arg);
  if (!node?.namespace || !node.component || !node.project) {
    vscode.window.showWarningMessage('Select a component or one of its environments in the OpenChoreo sidebar.');
    return undefined;
  }
  const client = await requireClient(deps);
  const base = { namespace: node.namespace, project: node.project, component: node.component };

  if (node.type === 'release-binding' && node.resourceName) {
    const environment = node.extra?.environment ?? (await bindingEnvironment(client, node.namespace, node.resourceName));
    return environment ? { ...base, environment, releaseBinding: node.resourceName } : undefined;
  }

  const { data } = await client.GET('/api/v1/namespaces/{namespaceName}/releasebindings', {
    params: { path: { namespaceName: node.namespace }, query: { component: node.component } },
  });
  const envs = (data?.items ?? [])
    .map((b) => (b as { spec?: { environment?: string } }).spec?.environment)
    .filter((e): e is string => !!e);
  if (envs.length === 0) {
    vscode.window.showWarningMessage(`${node.component} is not deployed to any environment yet.`);
    return undefined;
  }
  const environment =
    envs.length === 1 ? envs[0] : await vscode.window.showQuickPick(envs, { placeHolder: 'Environment' });
  return environment ? { ...base, environment } : undefined;
}

async function bindingEnvironment(client: Client, namespace: string, name: string): Promise<string | undefined> {
  const { data } = await client.GET('/api/v1/namespaces/{namespaceName}/releasebindings/{releaseBindingName}', {
    params: { path: { namespaceName: namespace, releaseBindingName: name } },
  });
  return (data as { spec?: { environment?: string } } | undefined)?.spec?.environment;
}

async function pickEnvironment(client: Client, namespace: string): Promise<string | undefined> {
  const { data, error } = await client.GET('/api/v1/namespaces/{namespaceName}/environments', {
    params: { path: { namespaceName: namespace } },
  });
  if (error) throw new Error(`Failed to list environments: ${JSON.stringify(error)}`);
  const envs = (data?.items ?? []).map((e) => e.metadata?.name).filter((n): n is string => !!n);
  if (envs.length === 0) throw new Error(`No environments in namespace "${namespace}".`);
  return envs.length === 1 ? envs[0] : vscode.window.showQuickPick(envs, { placeHolder: 'Environment' });
}

/**
 * The Workload manifest(s) to run: the clicked file or folder, else the active
 * editor's YAML, else a pick from the workspace's workload files.
 */
async function resolveWorkloadUri(arg: unknown): Promise<vscode.Uri | undefined> {
  if (arg instanceof vscode.Uri) return arg;
  const active = vscode.window.activeTextEditor?.document;
  if (active && /^kind:\s*Workload\s*$/m.test(active.getText())) return active.uri;

  const files = await vscode.workspace.findFiles('**/workload.{yaml,yml}', '**/node_modules/**', 50);
  if (files.length === 0) {
    vscode.window.showWarningMessage(
      'No workload.yaml found. Open a Workload manifest, or scaffold one with "OpenChoreo: Scaffold Component from this Project".',
    );
    return undefined;
  }
  if (files.length === 1) return files[0];
  const picked = await vscode.window.showQuickPick(
    files.map((uri) => ({ label: vscode.workspace.asRelativePath(uri), uri })),
    { placeHolder: 'Workload to run locally' },
  );
  return picked?.uri;
}

function runInTerminal(name: string, binary: string, args: string[], cwd?: string): void {
  const terminal = vscode.window.createTerminal({ name, cwd });
  terminal.show();
  terminal.sendText([binary, ...args].map(shellQuote).join(' '));
}

/** POSIX-quote an argument unless it is plainly safe. */
export function shellQuote(arg: string): string {
  return /^[A-Za-z0-9_./:=@-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

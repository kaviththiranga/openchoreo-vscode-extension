// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Debug Against Environment: any launch configuration with an `openchoreo`
 * attribute opens `occ remote` tunnels to that environment's dependencies
 * before the debugger starts and gets the resolved bindings in its `env`.
 *
 *   "openchoreo": { "environment": "development", "workload": "${workspaceFolder}/workload.yaml" }
 *
 * Optional: "namespace", "local" ({ component: "host:port" }), "secrets" (default true).
 */
import * as path from 'path';
import * as vscode from 'vscode';
import {
  pickEnvironment,
  requireClient,
  requireServer,
  resolveWorkloadUri,
  type DevLoopDeps,
} from '../commands/devLoopCommands';
import { TunnelManager, type TunnelSession } from './tunnels';

export interface OpenChoreoLaunchSettings {
  environment: string;
  workload: string | string[];
  namespace?: string;
  local?: Record<string, string>;
  secrets?: boolean;
}

const SESSION_KEY = '__openchoreoTunnel';

/** Validate the `openchoreo` launch attribute; returns an error message or the settings. */
export function readLaunchSettings(value: unknown): OpenChoreoLaunchSettings | string {
  if (!value || typeof value !== 'object') return '"openchoreo" must be an object with "environment" and "workload".';
  const v = value as Record<string, unknown>;
  if (typeof v.environment !== 'string' || !v.environment) return '"openchoreo.environment" is required.';
  const workloads = Array.isArray(v.workload) ? v.workload : [v.workload];
  if (workloads.length === 0 || workloads.some((w) => typeof w !== 'string' || !w)) {
    return '"openchoreo.workload" must be a workload.yaml path or a list of them.';
  }
  if (v.local !== undefined && (typeof v.local !== 'object' || Object.values(v.local as object).some((a) => typeof a !== 'string'))) {
    return '"openchoreo.local" maps component names to "host:port".';
  }
  return {
    environment: v.environment,
    workload: v.workload as string | string[],
    namespace: typeof v.namespace === 'string' ? v.namespace : undefined,
    local: v.local as Record<string, string> | undefined,
    secrets: v.secrets !== false,
  };
}

/** Tunnel bindings win over the configuration's own `env` for the same names. */
export function mergeEnv(configEnv: unknown, bindings: Record<string, string>): Record<string, string> {
  const base = configEnv && typeof configEnv === 'object' ? (configEnv as Record<string, string>) : {};
  return { ...base, ...bindings };
}

export function registerDebugAgainstEnv(context: vscode.ExtensionContext, deps: DevLoopDeps): void {
  const tunnels = new TunnelManager(deps.resolveBinary);
  const byDebugSession = new Map<string, TunnelSession>();
  const pendingByKey = new Map<string, TunnelSession>();
  context.subscriptions.push(tunnels);

  const provider: vscode.DebugConfigurationProvider = {
    async resolveDebugConfigurationWithSubstitutedVariables(folder, config) {
      if (config.openchoreo === undefined) return config;
      const settings = readLaunchSettings(config.openchoreo);
      if (typeof settings === 'string') {
        vscode.window.showErrorMessage(`Launch configuration "${config.name}": ${settings}`);
        return undefined;
      }
      if (!requireServer(deps, 1, 3, 'Debug Against Environment')) return undefined;
      const cwd = folder?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
      const workloads = (Array.isArray(settings.workload) ? settings.workload : [settings.workload]).map((w) =>
        path.isAbsolute(w) ? w : path.join(cwd, w),
      );
      const session = tunnels.start({
        workloads,
        environment: settings.environment,
        namespace: settings.namespace ?? deps.authProvider.getContextInfo()?.namespace,
        local: settings.local,
        secrets: settings.secrets !== false,
        cwd,
      });
      try {
        const result = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Opening tunnels to ${settings.environment}…` },
          () => session.ready,
        );
        if (result.hidden.length) {
          vscode.window.showWarningMessage(`Not resolved from ${settings.environment}: ${result.hidden.join(', ')}.`);
        }
        const key = `${Date.now()}-${Math.random()}`;
        pendingByKey.set(key, session);
        session.users++;
        // A debugger that never starts (bad configuration, missing adapter) releases the tunnels.
        setTimeout(() => {
          if (pendingByKey.delete(key)) release(session);
        }, 60_000);
        return { ...config, env: mergeEnv(config.env, result.env), [SESSION_KEY]: key };
      } catch (err) {
        const SHOW = 'Show Output';
        void vscode.window
          .showErrorMessage(`Tunnels to ${settings.environment} failed: ${err instanceof Error ? err.message : err}`, SHOW)
          .then((c) => c === SHOW && tunnels.showOutput());
        if (session.users === 0) tunnels.stop(session);
        return undefined;
      }
    },
  };

  const release = (session: TunnelSession | undefined) => {
    if (!session) return;
    session.users = Math.max(0, session.users - 1);
    const keepOpen = vscode.workspace.getConfiguration('openchoreo.localDev').get<boolean>('keepTunnelsOpen', false);
    if (session.users === 0 && !keepOpen) tunnels.stop(session);
  };

  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider('*', provider),
    vscode.debug.onDidStartDebugSession((s) => {
      const key = s.configuration[SESSION_KEY] as string | undefined;
      const session = key ? pendingByKey.get(key) : undefined;
      if (key && session) {
        pendingByKey.delete(key);
        byDebugSession.set(s.id, session);
      }
    }),
    vscode.debug.onDidTerminateDebugSession((s) => {
      release(byDebugSession.get(s.id));
      byDebugSession.delete(s.id);
    }),

    vscode.commands.registerCommand('openchoreo.debugLocally', async (arg: unknown) => {
      if (!requireServer(deps, 1, 3, 'Debug Against Environment')) return;
      try {
        const workload = await resolveWorkloadUri(arg);
        if (!workload) return;
        const folder = vscode.workspace.getWorkspaceFolder(workload);
        if (!folder) {
          vscode.window.showWarningMessage('Open the folder that contains the workload to debug it.');
          return;
        }
        const namespace = deps.authProvider.getContextInfo()?.namespace ?? 'default';
        const environment = await pickEnvironment(await requireClient(deps), namespace);
        if (!environment) return;

        const launch = vscode.workspace.getConfiguration('launch', folder);
        const configurations = (launch.get<vscode.DebugConfiguration[]>('configurations') ?? []).filter((c) => c.request);
        if (configurations.length === 0) {
          const CREATE = 'Create launch.json';
          const choice = await vscode.window.showInformationMessage(
            'Add a launch configuration for your app first, then run Debug Against Environment again.',
            CREATE,
          );
          if (choice === CREATE) await vscode.commands.executeCommand('workbench.action.debug.configure');
          return;
        }
        const picked =
          configurations.length === 1
            ? configurations[0]
            : (await vscode.window.showQuickPick(
                configurations.map((c) => ({ label: c.name, description: c.type, config: c })),
                { placeHolder: `Debug against ${environment} with` },
              ))?.config;
        if (!picked) return;

        const relative = path.relative(folder.uri.fsPath, workload.fsPath).split(path.sep).join('/');
        const settings: OpenChoreoLaunchSettings = { environment, workload: `\${workspaceFolder}/${relative}` };
        const started = await vscode.debug.startDebugging(folder, { ...picked, openchoreo: settings });
        if (!started || picked.openchoreo) return;

        const SAVE = 'Add to launch.json';
        const choice = await vscode.window.showInformationMessage(
          `Save the ${environment} tunnels in the "${picked.name}" launch configuration, so F5 opens them?`,
          SAVE,
        );
        if (choice === SAVE) {
          const all = launch.get<vscode.DebugConfiguration[]>('configurations') ?? [];
          await launch.update(
            'configurations',
            all.map((c) => (c.name === picked.name ? { ...c, openchoreo: settings } : c)),
            vscode.ConfigurationTarget.WorkspaceFolder,
          );
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Debug Against Environment failed: ${err instanceof Error ? err.message : err}`);
      }
    }),

    vscode.commands.registerCommand('openchoreo.manageTunnels', async () => {
      const sessions = tunnels.list();
      if (sessions.length === 0) {
        vscode.window.showInformationMessage('No OpenChoreo tunnels are open.');
        return;
      }
      const items = [
        ...sessions.map((s) => ({
          label: `$(debug-stop) Close ${s.options.environment} tunnels`,
          description: s.options.workloads.map((w) => vscode.workspace.asRelativePath(w)).join(', '),
          run: () => tunnels.stop(s),
        })),
        { label: '$(output) Show Output', description: '', run: () => tunnels.showOutput() },
      ];
      (await vscode.window.showQuickPick(items, { placeHolder: 'OpenChoreo tunnels' }))?.run();
    }),
  );
}

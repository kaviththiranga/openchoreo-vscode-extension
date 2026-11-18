// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { ObservabilityUrlResolver } from '@openchoreo/openchoreo-client-node';
import type { AuthSession, OccConfigAuthProvider } from '../auth/authProvider';
import type { ApiClientManager } from '../api/apiClient';
import { log } from '../logging/logger';
import { discoverObservabilityEndpoints, type ObservabilityEndpoints } from './mcpDiscovery';
import { buildMcpServerSpecs, DEVELOPER_TOOLSETS } from './mcpServers';

/** How long the first server list waits for observability discovery. */
const DISCOVERY_WAIT_MS = 4000;

/**
 * Registers the OpenChoreo MCP servers with VS Code: the control plane
 * (developer toolsets, plus an opt-in platform-engineer server), and the
 * observer and SRE agent servers discovered from the current namespace.
 * All of them get the occ session's Bearer token.
 */
export function registerMcpServers(
  context: vscode.ExtensionContext,
  authProvider: OccConfigAuthProvider,
  apiClientManager: ApiClientManager,
): void {
  // Check if the MCP API is available (VSCode 1.99+)
  if (!vscode.lm?.registerMcpServerDefinitionProvider) {
    log.debug('MCP server registration not available (requires VSCode 1.99+)');
    return;
  }

  try {
    const onDidChangeEmitter = new vscode.EventEmitter<void>();
    let discovery: { key: string; promise: Promise<ObservabilityEndpoints> } | undefined;
    let refreshWhenDiscovered = false;

    const discover = (session: AuthSession, token: string | undefined) => {
      const key = `${session.controlPlaneUrl}|${session.context.namespace}`;
      if (discovery?.key === key) return discovery.promise;
      const promise = discoverObservabilityEndpoints({
        namespace: session.context.namespace,
        token,
        resolver: new ObservabilityUrlResolver({ baseUrl: session.controlPlaneUrl }),
        listEnvironments: async () => {
          const client = await apiClientManager.getClient();
          if (!client) return [];
          const { data, error } = await client.GET('/api/v1/namespaces/{namespaceName}/environments', {
            params: { path: { namespaceName: session.context.namespace } },
          });
          if (error) throw new Error(JSON.stringify(error));
          return (data?.items ?? []).map((e) => e.metadata?.name).filter((n): n is string => !!n);
        },
        log: (message) => log.debug(message),
      });
      discovery = { key, promise };
      void promise.then((found) => {
        if (discovery?.promise !== promise) return;
        // Retry on the next session change rather than caching a miss that
        // may come from a transient error or a token that just expired.
        const empty = found.observerUrls.length === 0 && found.sreAgentUrls.length === 0;
        if (empty) discovery = undefined;
        if (refreshWhenDiscovered) {
          refreshWhenDiscovered = false;
          if (!empty) onDidChangeEmitter.fire();
        }
      });
      return promise;
    };

    const observability = async (
      session: AuthSession,
      token: string | undefined,
    ): Promise<ObservabilityEndpoints> => {
      const config = vscode.workspace.getConfiguration('openchoreo.mcp');
      if (!config.get<boolean>('observability', true)) return { observerUrls: [], sreAgentUrls: [] };
      const observerUrl = config.get<string>('observerUrl', '').trim();
      const sreAgentUrl = config.get<string>('sreAgentUrl', '').trim();
      if (observerUrl && sreAgentUrl) return { observerUrls: [observerUrl], sreAgentUrls: [sreAgentUrl] };

      const pending = discover(session, token);
      const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), DISCOVERY_WAIT_MS));
      const found = await Promise.race([pending, timeout]);
      if (!found) {
        // Serve the control plane now; add the rest once discovery finishes.
        refreshWhenDiscovered = true;
        log.debug('MCP: observability discovery still running; serving control plane first');
      }
      return {
        observerUrls: observerUrl ? [observerUrl] : (found?.observerUrls ?? []),
        sreAgentUrls: sreAgentUrl ? [sreAgentUrl] : (found?.sreAgentUrls ?? []),
      };
    };

    const provider: vscode.McpServerDefinitionProvider = {
      onDidChangeMcpServerDefinitions: onDidChangeEmitter.event,

      async provideMcpServerDefinitions(): Promise<vscode.McpServerDefinition[]> {
        try {
          const session = authProvider.getSession();
          if (!session) {
            log.debug('MCP: no session, returning empty server list');
            return [];
          }
          // Auth-disabled clusters have no token. Sending an empty Bearer
          // header makes some HTTP servers 401 before the MCP handshake,
          // which causes Copilot Chat to drop the server from the catalog.
          const token = session.securityEnabled ? await authProvider.getToken() : undefined;
          const config = vscode.workspace.getConfiguration('openchoreo.mcp');
          const specs = buildMcpServerSpecs({
            controlPlaneUrl: session.controlPlaneUrl,
            token: token || undefined,
            toolsets: config.get<string[]>('toolsets', DEVELOPER_TOOLSETS),
            platformEngineerTools: config.get<boolean>('platformEngineerTools', false),
            ...(await observability(session, token || undefined)),
          });
          log.debug(
            `MCP servers providing: ${specs.map((s) => `${s.label}=${s.url}`).join(', ')} ` +
              `(auth: ${session.securityEnabled ? 'bearer' : 'disabled'})`,
          );
          return specs.map(
            (s) => new vscode.McpHttpServerDefinition(s.label, vscode.Uri.parse(s.url), s.headers),
          );
        } catch (err) {
          log.error('MCP: error in provideMcpServerDefinitions', err);
          return [];
        }
      },
    };

    const disposable = vscode.lm.registerMcpServerDefinitionProvider('openchoreo', provider);
    context.subscriptions.push(disposable);
    context.subscriptions.push(onDidChangeEmitter);

    // Re-provide when the session changes (token refresh, context or namespace switch)
    context.subscriptions.push(
      authProvider.onDidChangeSession(() => {
        onDidChangeEmitter.fire();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration('openchoreo.mcp')) return;
        discovery = undefined;
        onDidChangeEmitter.fire();
      }),
    );

    log.info('OpenChoreo MCP server provider registered');

    // First-run nudge: VS Code does not auto-start newly-registered MCP
    // servers (security feature, no programmatic override). Show a one-time
    // info toast so users know they need to click Start in "MCP: List Servers"
    // before the OpenChoreo tools appear in Copilot Chat.
    void promptToStartMcpServerOnce(context);
  } catch (err) {
    log.error('Failed to register MCP server provider', err);
  }
}

const MCP_START_PROMPT_KEY = 'mcp.startPromptShown';

async function promptToStartMcpServerOnce(
  context: vscode.ExtensionContext,
): Promise<void> {
  if (context.globalState.get<boolean>(MCP_START_PROMPT_KEY)) return;
  // Record immediately so the toast only ever fires once even if the user
  // dismisses without clicking — we don't want to re-pester on every reload.
  await context.globalState.update(MCP_START_PROMPT_KEY, true);

  const choice = await vscode.window.showInformationMessage(
    'OpenChoreo MCP servers registered. Start them from "MCP: List Servers" to enable OpenChoreo tools in chat.',
    'Open MCP: List Servers',
    'Dismiss',
  );
  if (choice === 'Open MCP: List Servers') {
    try {
      await vscode.commands.executeCommand('workbench.mcp.showServers');
    } catch {
      // Command id varies across VS Code versions; fall back to opening the
      // command palette pre-filled with the user-visible name.
      try {
        await vscode.commands.executeCommand(
          'workbench.action.quickOpen',
          '>MCP: List Servers',
        );
      } catch {
        // Last resort: do nothing — the README explains the manual path.
      }
    }
  }
}

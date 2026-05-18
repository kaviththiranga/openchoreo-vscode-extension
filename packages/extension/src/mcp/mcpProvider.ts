// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import type { OccConfigAuthProvider } from '../auth/authProvider';
import { log } from '../logging/logger';

/**
 * Registers the OpenChoreo Platform MCP server with VSCode's Copilot Chat.
 * The MCP server URL is derived from the occ CLI control plane URL.
 * Auth token is passed via headers from the existing session.
 */
export function registerMcpServers(
  context: vscode.ExtensionContext,
  authProvider: OccConfigAuthProvider,
): void {
  // Check if the MCP API is available (VSCode 1.99+)
  if (!vscode.lm?.registerMcpServerDefinitionProvider) {
    log.debug('MCP server registration not available (requires VSCode 1.99+)');
    return;
  }

  try {
    const onDidChangeEmitter = new vscode.EventEmitter<void>();

    const provider: vscode.McpServerDefinitionProvider = {
      onDidChangeMcpServerDefinitions: onDidChangeEmitter.event,

      provideMcpServerDefinitions(): vscode.McpServerDefinition[] {
        try {
          const session = authProvider.getSession();
          if (!session) {
            log.debug('MCP: no session, returning empty server list');
            return [];
          }

          // On auth-disabled clusters the MCP endpoint's `filterByAuthz`
          // default of `true` filters tools/list by the authenticated user's
          // permissions — and there is no user, so the list is empty. Pass
          // `?filterByAuthz=false` so the server skips per-user filtering.
          // (Per docs the control plane API still enforces its own authz
          // independently, so this only changes what's *advertised*.)
          const platformUrl = session.securityEnabled
            ? `${session.controlPlaneUrl}/mcp`
            : `${session.controlPlaneUrl}/mcp?filterByAuthz=false`;
          const mcpUri = vscode.Uri.parse(platformUrl);

          // Auth-disabled clusters have no token. Sending an empty Bearer
          // header makes some HTTP servers 401 before the MCP handshake,
          // which causes Copilot Chat to drop the server from the catalog.
          // Omit the header entirely in that case.
          const headers: Record<string, string> = session.securityEnabled
            ? { Authorization: `Bearer ${session.token}` }
            : {};

          const server = new vscode.McpHttpServerDefinition(
            'OpenChoreo Platform',
            mcpUri,
            headers,
          );

          log.debug(
            `MCP server providing: ${platformUrl} (auth: ${session.securityEnabled ? 'bearer' : 'disabled'})`,
          );
          return [server];
        } catch (err) {
          log.error('MCP: error in provideMcpServerDefinitions', err);
          return [];
        }
      },
    };

    const disposable = vscode.lm.registerMcpServerDefinitionProvider('openchoreo', provider);
    context.subscriptions.push(disposable);
    context.subscriptions.push(onDidChangeEmitter);

    // Re-register when session changes (token refresh, context switch, namespace switch)
    context.subscriptions.push(
      authProvider.onDidChangeSession(() => {
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
    'OpenChoreo MCP server registered. Start it from "MCP: List Servers" to enable AI tools in Copilot Chat.',
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

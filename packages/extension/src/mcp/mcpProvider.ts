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

          const platformUrl = `${session.controlPlaneUrl}/mcp`;
          const mcpUri = vscode.Uri.parse(platformUrl);
          const server = new vscode.McpHttpServerDefinition(
            'OpenChoreo Platform',
            mcpUri,
            { Authorization: `Bearer ${session.token}` },
          );

          log.debug(`MCP server providing: ${platformUrl}`);
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
  } catch (err) {
    log.error('Failed to register MCP server provider', err);
  }
}

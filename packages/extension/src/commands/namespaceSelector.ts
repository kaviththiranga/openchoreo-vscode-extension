// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import type { OccConfigAuthProvider } from '../auth/authProvider';
import type { ApiClientManager } from '../api/apiClient';
import { log } from '../logging/logger';

/**
 * Registers the namespace selector command.
 * Shows a quick pick with all accessible namespaces and updates the occ CLI config on selection.
 */
export function registerNamespaceSelector(
  context: vscode.ExtensionContext,
  authProvider: OccConfigAuthProvider,
  apiClientManager: ApiClientManager,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.selectNamespace',
      async () => {
        try {
          const client = await apiClientManager.getClient();
          if (!client) {
            vscode.window.showWarningMessage(
              'Not authenticated. Run "occ login" first.',
            );
            return;
          }

          log.debug('Fetching namespaces for namespace selector');
          const { data, error } = await client.GET('/api/v1/namespaces');
          if (error || !data?.items?.length) {
            vscode.window.showWarningMessage('No namespaces available.');
            return;
          }

          const contextInfo = authProvider.getContextInfo();
          const currentNs = contextInfo?.namespace;

          const items = data.items.map((ns) => {
            const name = (ns.metadata?.name as string) ?? 'unknown';
            return {
              label: name,
              description: name === currentNs ? '(current)' : undefined,
              picked: name === currentNs,
            };
          });

          const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select namespace',
            title: 'OpenChoreo: Switch Namespace',
          });

          if (!selected || selected.label === currentNs) {
            return;
          }

          log.info(`Switching namespace to: ${selected.label}`);
          authProvider.updateNamespace(selected.label);
          vscode.window.showInformationMessage(
            `Switched to namespace: ${selected.label}`,
          );
        } catch (err) {
          log.error('Failed to fetch namespaces', err);
          vscode.window.showErrorMessage(
            `Failed to load namespaces: ${err instanceof Error ? err.message : 'Connection error'}. Try "occ login" to re-authenticate.`,
          );
        }
      },
    ),
  );
}

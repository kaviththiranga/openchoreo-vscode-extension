// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import type { OccConfigAuthProvider } from '../auth/authProvider';
import type { ApiClientManager } from '../api/apiClient';
import { log } from '../logging/logger';

const CREATE_NS_LABEL = '$(add) Create New Namespace...';

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
          if (error) {
            vscode.window.showWarningMessage('Failed to fetch namespaces.');
            return;
          }

          const contextInfo = authProvider.getContextInfo();
          const currentNs = contextInfo?.namespace;

          const items: vscode.QuickPickItem[] = [];

          if (data?.items?.length) {
            for (const ns of data.items) {
              const name = (ns.metadata?.name as string) ?? 'unknown';
              items.push({
                label: name,
                description: name === currentNs ? '(current)' : undefined,
              });
            }
            items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
          }

          items.push({ label: CREATE_NS_LABEL, alwaysShow: true });

          const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select namespace',
            title: 'OpenChoreo: Switch Namespace',
          });

          if (!selected) return;

          if (selected.label === CREATE_NS_LABEL) {
            await createNamespace(client, authProvider);
            return;
          }

          if (selected.label === currentNs) return;

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

async function createNamespace(
  client: NonNullable<Awaited<ReturnType<ApiClientManager['getClient']>>>,
  authProvider: OccConfigAuthProvider,
): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: 'Enter name for the new namespace',
    placeHolder: 'e.g., my-team',
    validateInput: (value) => {
      if (!value) return 'Name is required';
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(value)) {
        return 'Must be lowercase alphanumeric with optional hyphens, cannot start/end with hyphen';
      }
      return undefined;
    },
  });

  if (!name) return;

  try {
    const { error } = await client.POST('/api/v1/namespaces', {
      body: { metadata: { name } },
    } as any);

    if (error) {
      vscode.window.showErrorMessage(
        `Failed to create namespace: ${JSON.stringify(error)}`,
      );
      return;
    }

    authProvider.updateNamespace(name);
    vscode.window.showInformationMessage(
      `Namespace '${name}' created and selected.`,
    );
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to create namespace: ${err instanceof Error ? err.message : 'Unknown error'}`,
    );
  }
}

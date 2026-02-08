// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { OccConfigAuthProvider } from '../auth/authProvider';
import { ResourceExplorerProvider } from '../treeView/resourceExplorer';

const SCHEME = 'openchoreo';

export function registerCommands(
  context: vscode.ExtensionContext,
  authProvider: OccConfigAuthProvider,
  resourceExplorer: ResourceExplorerProvider,
): void {
  // Register virtual document provider for readonly resource views
  const resourceContentProvider = new OpenChoreoResourceProvider(authProvider);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      SCHEME,
      resourceContentProvider,
    ),
  );

  // Refresh resources
  context.subscriptions.push(
    vscode.commands.registerCommand('openchoreo.refreshResources', () => {
      authProvider.loadConfig();
      resourceExplorer.refresh();
    }),
  );

  // Switch context
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.switchContext',
      async () => {
        const contexts = authProvider.getAvailableContexts();
        if (contexts.length === 0) {
          vscode.window.showWarningMessage(
            'No OpenChoreo contexts found. Run "occ config set-context" to create one.',
          );
          return;
        }

        const selected = await vscode.window.showQuickPick(contexts, {
          placeHolder: 'Select OpenChoreo context',
        });

        if (selected) {
          vscode.window.showInformationMessage(
            `To switch context, run: occ config use-context ${selected}`,
          );
        }
      },
    ),
  );

  // Login prompt
  context.subscriptions.push(
    vscode.commands.registerCommand('openchoreo.login', () => {
      const terminal = vscode.window.createTerminal('OpenChoreo Login');
      terminal.show();
      terminal.sendText('occ login');
    }),
  );

  // Open resource as readonly virtual document
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.openResource',
      async (node: {
        type?: string;
        namespace?: string;
        project?: string;
        component?: string;
      }) => {
        if (!node?.namespace) {
          return;
        }

        // Build a descriptive file name and API path based on node type
        let fileName: string;
        let apiPath: string;
        const base = `/api/v1/namespaces/${node.namespace}`;

        if (node.component && node.project) {
          fileName = `${node.namespace}/${node.project}/${node.component}.json`;
          apiPath = `${base}/projects/${node.project}/components/${node.component}`;
        } else if (node.project) {
          fileName = `${node.namespace}/${node.project}.json`;
          apiPath = `${base}/projects/${node.project}`;
        } else {
          fileName = `${node.namespace}.json`;
          apiPath = `${base}`;
        }

        // Encode the API path in the URI query so the content provider can fetch it
        const uri = vscode.Uri.parse(
          `${SCHEME}:${fileName}?path=${encodeURIComponent(apiPath)}`,
        );

        try {
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc, { preview: true });
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to open resource: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      },
    ),
  );
}

/**
 * Virtual document provider that fetches OpenChoreo resources via API
 * and presents them as readonly JSON documents.
 */
class OpenChoreoResourceProvider
  implements vscode.TextDocumentContentProvider
{
  private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(private readonly authProvider: OccConfigAuthProvider) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const session = this.authProvider.getSession();
    const token = await this.authProvider.getToken();

    if (!session || !token) {
      return '// Not authenticated. Run "occ login" first.';
    }

    const apiPath = decodeURIComponent(uri.query.replace('path=', ''));
    const url = `${session.controlPlaneUrl}${apiPath}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      return `// Error: HTTP ${response.status} from ${apiPath}`;
    }

    const json = (await response.json()) as { data?: unknown };
    // Unwrap the { success, data } envelope
    const payload = json.data ?? json;
    return JSON.stringify(payload, null, 2);
  }
}

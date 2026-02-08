// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { OccConfigAuthProvider } from '../auth/authProvider';
import { ResourceExplorerProvider } from '../treeView/resourceExplorer';
import type { ApiClientManager } from '../api/apiClient';

const SCHEME = 'openchoreo';

export function registerCommands(
  context: vscode.ExtensionContext,
  authProvider: OccConfigAuthProvider,
  resourceExplorer: ResourceExplorerProvider,
  apiClientManager: ApiClientManager,
): void {
  // Register virtual document provider for readonly resource views
  const resourceContentProvider = new OpenChoreoResourceProvider(
    apiClientManager,
  );
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

        // Build a descriptive file name and encode structured params in query
        let fileName: string;
        const params = new URLSearchParams();
        params.set('ns', node.namespace);

        if (node.component && node.project) {
          fileName = `${node.namespace}/${node.project}/${node.component}.json`;
          params.set('type', 'component');
          params.set('proj', node.project);
          params.set('comp', node.component);
        } else if (node.project) {
          fileName = `${node.namespace}/${node.project}.json`;
          params.set('type', 'project');
          params.set('proj', node.project);
        } else {
          fileName = `${node.namespace}.json`;
          params.set('type', 'namespace');
        }

        const uri = vscode.Uri.parse(
          `${SCHEME}:${fileName}?${params.toString()}`,
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
 * Virtual document provider that fetches OpenChoreo resources via the typed API client
 * and presents them as readonly JSON documents.
 */
class OpenChoreoResourceProvider
  implements vscode.TextDocumentContentProvider
{
  private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(private readonly apiClientManager: ApiClientManager) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const client = await this.apiClientManager.getClient();
    if (!client) {
      return '// Not authenticated. Run "occ login" first.';
    }

    const params = new URLSearchParams(uri.query);
    const type = params.get('type');
    const ns = params.get('ns');

    if (!ns) {
      return '// Error: missing namespace parameter';
    }

    try {
      let payload: unknown;

      if (type === 'component') {
        const proj = params.get('proj');
        const comp = params.get('comp');
        if (!proj || !comp) {
          return '// Error: missing project or component parameter';
        }
        const { data, error } = await client.GET(
          '/namespaces/{namespaceName}/projects/{projectName}/components/{componentName}',
          {
            params: {
              path: {
                namespaceName: ns,
                projectName: proj,
                componentName: comp,
              },
            },
          },
        );
        if (error) {
          return `// Error fetching component: ${JSON.stringify(error)}`;
        }
        payload = data?.data ?? data;
      } else if (type === 'project') {
        const proj = params.get('proj');
        if (!proj) {
          return '// Error: missing project parameter';
        }
        const { data, error } = await client.GET(
          '/namespaces/{namespaceName}/projects/{projectName}',
          {
            params: {
              path: { namespaceName: ns, projectName: proj },
            },
          },
        );
        if (error) {
          return `// Error fetching project: ${JSON.stringify(error)}`;
        }
        payload = data?.data ?? data;
      } else {
        // namespace: list projects as a summary
        const { data, error } = await client.GET(
          '/namespaces/{namespaceName}/projects',
          {
            params: { path: { namespaceName: ns } },
          },
        );
        if (error) {
          return `// Error fetching namespace projects: ${JSON.stringify(error)}`;
        }
        payload = data?.data ?? data;
      }

      return JSON.stringify(payload, null, 2);
    } catch (error) {
      return `// Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }
}

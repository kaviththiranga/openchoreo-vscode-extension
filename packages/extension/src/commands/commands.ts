// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { OccConfigAuthProvider } from '../auth/authProvider';
import { ResourceExplorerProvider } from '../treeView/resourceExplorer';
import { InfrastructureExplorerProvider } from '../treeView/infrastructureExplorer';
import type { ApiClientManager } from '../api/apiClient';
import type { ResourceNodeData } from '../treeView/types';

const SCHEME = 'openchoreo';

export function registerCommands(
  context: vscode.ExtensionContext,
  authProvider: OccConfigAuthProvider,
  resourceExplorer: ResourceExplorerProvider,
  infrastructureExplorer: InfrastructureExplorerProvider,
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

  // Refresh infrastructure
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.refreshInfrastructure',
      () => {
        authProvider.loadConfig();
        infrastructureExplorer.refresh();
      },
    ),
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
      async (node: ResourceNodeData) => {
        if (!node) {
          return;
        }

        const params = new URLSearchParams();
        params.set('type', node.type);

        if (node.namespace) {
          params.set('ns', node.namespace);
        }
        if (node.project) {
          params.set('proj', node.project);
        }
        if (node.component) {
          params.set('comp', node.component);
        }
        if (node.resourceName) {
          params.set('name', node.resourceName);
        }

        // Build a descriptive file name
        const fileName = buildFileName(node);
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

function buildFileName(node: ResourceNodeData): string {
  const parts: string[] = [];
  if (node.namespace) {
    parts.push(node.namespace);
  }
  if (node.project) {
    parts.push(node.project);
  }
  if (node.component) {
    parts.push(node.component);
  }
  if (node.resourceName) {
    parts.push(node.resourceName);
  }

  // For top-level resources without namespace context, use the type
  if (parts.length === 0) {
    parts.push(node.type);
  }

  return parts.join('/') + '.json';
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
    const proj = params.get('proj');
    const comp = params.get('comp');
    const name = params.get('name');

    try {
      const payload = await this.fetchResource(
        client,
        type,
        ns,
        proj,
        comp,
        name,
      );
      return JSON.stringify(payload, null, 2);
    } catch (error) {
      return `// Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private async fetchResource(
    client: NonNullable<
      Awaited<ReturnType<ApiClientManager['getClient']>>
    >,
    type: string | null,
    ns: string | null,
    proj: string | null,
    comp: string | null,
    name: string | null,
  ): Promise<unknown> {
    // --- Resource view types ---
    if (type === 'namespace' && ns) {
      const { data, error } = await client.GET(
        '/namespaces/{namespaceName}/projects',
        { params: { path: { namespaceName: ns } } },
      );
      if (error) {
        throw new Error(`Failed to fetch namespace: ${JSON.stringify(error)}`);
      }
      return data?.data ?? data;
    }

    if (type === 'project' && ns && proj) {
      const { data, error } = await client.GET(
        '/namespaces/{namespaceName}/projects/{projectName}',
        { params: { path: { namespaceName: ns, projectName: proj } } },
      );
      if (error) {
        throw new Error(`Failed to fetch project: ${JSON.stringify(error)}`);
      }
      return data?.data ?? data;
    }

    if (type === 'component' && ns && proj && comp) {
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
        throw new Error(`Failed to fetch component: ${JSON.stringify(error)}`);
      }
      return data?.data ?? data;
    }

    if (type === 'deployment-pipeline' && ns && proj) {
      const { data, error } = await client.GET(
        '/namespaces/{namespaceName}/projects/{projectName}/deployment-pipeline',
        {
          params: {
            path: { namespaceName: ns, projectName: proj },
          },
        },
      );
      if (error) {
        throw new Error(
          `Failed to fetch deployment pipeline: ${JSON.stringify(error)}`,
        );
      }
      return data?.data ?? data;
    }

    if (type === 'workflow-run' && ns && proj && comp && name) {
      const { data, error } = await client.GET(
        '/namespaces/{namespaceName}/projects/{projectName}/components/{componentName}/workflow-runs/{runName}',
        {
          params: {
            path: {
              namespaceName: ns,
              projectName: proj,
              componentName: comp,
              runName: name,
            },
          },
        },
      );
      if (error) {
        throw new Error(
          `Failed to fetch workflow run: ${JSON.stringify(error)}`,
        );
      }
      return data?.data ?? data;
    }

    if (type === 'component-release' && ns && proj && comp && name) {
      const { data, error } = await client.GET(
        '/namespaces/{namespaceName}/projects/{projectName}/components/{componentName}/component-releases/{releaseName}',
        {
          params: {
            path: {
              namespaceName: ns,
              projectName: proj,
              componentName: comp,
              releaseName: name,
            },
          },
        },
      );
      if (error) {
        throw new Error(
          `Failed to fetch component release: ${JSON.stringify(error)}`,
        );
      }
      return data?.data ?? data;
    }

    if (type === 'release-binding' && ns && proj && comp && name) {
      // No GET-by-name for release bindings; fetch list and filter
      const { data, error } = await client.GET(
        '/namespaces/{namespaceName}/projects/{projectName}/components/{componentName}/release-bindings',
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
        throw new Error(
          `Failed to fetch release bindings: ${JSON.stringify(error)}`,
        );
      }
      const items =
        (data?.data as { items?: Array<{ name?: string }> })?.items ?? [];
      return items.find((i) => i.name === name) ?? data?.data ?? data;
    }

    if (type === 'component-trait' && ns && proj && comp) {
      // Traits endpoint returns all traits for the component
      const { data, error } = await client.GET(
        '/namespaces/{namespaceName}/projects/{projectName}/components/{componentName}/traits',
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
        throw new Error(
          `Failed to fetch component traits: ${JSON.stringify(error)}`,
        );
      }
      if (name) {
        const items =
          (data?.data as { items?: Array<{ name?: string }> })?.items ?? [];
        return items.find((i) => i.name === name) ?? data?.data ?? data;
      }
      return data?.data ?? data;
    }

    if (type === 'binding' && ns && proj && comp && name) {
      // Bindings: fetch list and filter
      const { data, error } = await client.GET(
        '/namespaces/{namespaceName}/projects/{projectName}/components/{componentName}/bindings',
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
        throw new Error(
          `Failed to fetch bindings: ${JSON.stringify(error)}`,
        );
      }
      const items =
        (data?.data as { items?: Array<{ name?: string }> })?.items ?? [];
      return items.find((i) => i.name === name) ?? data?.data ?? data;
    }

    if (type === 'workload' && ns && proj && comp) {
      const { data, error } = await client.GET(
        '/namespaces/{namespaceName}/projects/{projectName}/components/{componentName}/workloads',
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
        throw new Error(
          `Failed to fetch workloads: ${JSON.stringify(error)}`,
        );
      }
      return data?.data ?? data;
    }

    // --- Infrastructure view types ---
    if (type === 'environment' && ns && name) {
      const { data, error } = await client.GET(
        '/namespaces/{namespaceName}/environments/{envName}',
        {
          params: {
            path: { namespaceName: ns, envName: name },
          },
        },
      );
      if (error) {
        throw new Error(
          `Failed to fetch environment: ${JSON.stringify(error)}`,
        );
      }
      return data?.data ?? data;
    }

    if (type === 'data-plane' && ns && name) {
      const { data, error } = await client.GET(
        '/namespaces/{namespaceName}/dataplanes/{dpName}',
        {
          params: {
            path: { namespaceName: ns, dpName: name },
          },
        },
      );
      if (error) {
        throw new Error(
          `Failed to fetch data plane: ${JSON.stringify(error)}`,
        );
      }
      return data?.data ?? data;
    }

    if (type === 'build-plane' && ns && name) {
      // No GET-by-name; fetch list and filter
      const { data, error } = await client.GET(
        '/namespaces/{namespaceName}/buildplanes',
        { params: { path: { namespaceName: ns } } },
      );
      if (error) {
        throw new Error(
          `Failed to fetch build planes: ${JSON.stringify(error)}`,
        );
      }
      const items =
        (data?.data as { items?: Array<{ name?: string }> })?.items ?? [];
      return items.find((i) => i.name === name) ?? data?.data ?? data;
    }

    if (type === 'observability-plane' && ns && name) {
      // No GET-by-name; fetch list and filter
      const { data, error } = await client.GET(
        '/namespaces/{namespaceName}/observabilityplanes',
        { params: { path: { namespaceName: ns } } },
      );
      if (error) {
        throw new Error(
          `Failed to fetch observability planes: ${JSON.stringify(error)}`,
        );
      }
      const items =
        (data?.data as { items?: Array<{ name?: string }> })?.items ?? [];
      return items.find((i) => i.name === name) ?? data?.data ?? data;
    }

    if (type === 'component-type' && ns && name) {
      const { data, error } = await client.GET(
        '/namespaces/{namespaceName}/component-types/{ctName}/definition',
        {
          params: {
            path: { namespaceName: ns, ctName: name },
          },
        },
      );
      if (error) {
        throw new Error(
          `Failed to fetch component type: ${JSON.stringify(error)}`,
        );
      }
      return data?.data ?? data;
    }

    if (type === 'workflow' && ns && name) {
      const { data, error } = await client.GET(
        '/namespaces/{namespaceName}/workflows/{workflowName}/definition',
        {
          params: {
            path: { namespaceName: ns, workflowName: name },
          },
        },
      );
      if (error) {
        throw new Error(
          `Failed to fetch workflow: ${JSON.stringify(error)}`,
        );
      }
      return data?.data ?? data;
    }

    if (type === 'component-workflow' && ns && name) {
      const { data, error } = await client.GET(
        '/namespaces/{namespaceName}/component-workflows/{cwName}/definition',
        {
          params: {
            path: { namespaceName: ns, cwName: name },
          },
        },
      );
      if (error) {
        throw new Error(
          `Failed to fetch component workflow: ${JSON.stringify(error)}`,
        );
      }
      return data?.data ?? data;
    }

    if (type === 'trait' && ns && name) {
      const { data, error } = await client.GET(
        '/namespaces/{namespaceName}/traits/{traitName}/definition',
        {
          params: {
            path: { namespaceName: ns, traitName: name },
          },
        },
      );
      if (error) {
        throw new Error(`Failed to fetch trait: ${JSON.stringify(error)}`);
      }
      return data?.data ?? data;
    }

    if (type === 'secret-reference' && ns && name) {
      // No GET-by-name; fetch list and filter
      const { data, error } = await client.GET(
        '/namespaces/{namespaceName}/secret-references',
        { params: { path: { namespaceName: ns } } },
      );
      if (error) {
        throw new Error(
          `Failed to fetch secret references: ${JSON.stringify(error)}`,
        );
      }
      const items =
        (data?.data as { items?: Array<{ name?: string }> })?.items ?? [];
      return items.find((i) => i.name === name) ?? data?.data ?? data;
    }

    if (type === 'git-secret' && ns && name) {
      // No GET-by-name; fetch list and filter
      const { data, error } = await client.GET(
        '/namespaces/{namespaceName}/git-secrets',
        { params: { path: { namespaceName: ns } } },
      );
      if (error) {
        throw new Error(
          `Failed to fetch git secrets: ${JSON.stringify(error)}`,
        );
      }
      const items =
        (data?.data as { items?: Array<{ name?: string }> })?.items ?? [];
      return items.find((i) => i.name === name) ?? data?.data ?? data;
    }

    if (type === 'namespace-role' && ns && name) {
      const { data, error } = await client.GET(
        '/namespaces/{namespace}/roles/{name}',
        { params: { path: { namespace: ns, name } } },
      );
      if (error) {
        throw new Error(
          `Failed to fetch namespace role: ${JSON.stringify(error)}`,
        );
      }
      return data?.data ?? data;
    }

    if (type === 'namespace-role-binding' && ns && name) {
      const { data, error } = await client.GET(
        '/namespaces/{namespace}/rolebindings/{name}',
        { params: { path: { namespace: ns, name } } },
      );
      if (error) {
        throw new Error(
          `Failed to fetch namespace role binding: ${JSON.stringify(error)}`,
        );
      }
      return data?.data ?? data;
    }

    if (type === 'cluster-role' && name) {
      const { data, error } = await client.GET('/clusterroles/{name}', {
        params: { path: { name } },
      });
      if (error) {
        throw new Error(
          `Failed to fetch cluster role: ${JSON.stringify(error)}`,
        );
      }
      return data?.data ?? data;
    }

    if (type === 'cluster-role-binding' && name) {
      const { data, error } = await client.GET(
        '/clusterrolebindings/{name}',
        { params: { path: { name } } },
      );
      if (error) {
        throw new Error(
          `Failed to fetch cluster role binding: ${JSON.stringify(error)}`,
        );
      }
      return data?.data ?? data;
    }

    throw new Error(`Unknown resource type: ${type}`);
  }
}

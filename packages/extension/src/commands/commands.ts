// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { parse as parseYaml } from 'yaml';
import { OccConfigAuthProvider } from '../auth/authProvider';
import { ResourceExplorerProvider } from '../treeView/resourceExplorer';
import { InfrastructureExplorerProvider } from '../treeView/infrastructureExplorer';
import type { ApiClientManager } from '../api/apiClient';
import type { CapabilityService } from '../services/capabilityService';
import type { DeleteService } from '../services/deleteService';
import type { ResourceNodeData } from '../treeView/types';
import {
  DEFINITION_RESOURCE_TYPES,
  crdToYaml,
  CRD_KIND_TO_SCAFFOLD,
} from '../services/yamlService';

type Client = NonNullable<
  Awaited<ReturnType<ApiClientManager['getClient']>>
>;

type LegacyClient = NonNullable<
  Awaited<ReturnType<ApiClientManager['getLegacyClient']>>
>;

const SCHEME = 'openchoreo';

/** Legacy-only types that use legacy API for GET definition. */
const LEGACY_DEFINITION_TYPES = new Set([
  'namespace',
  'component-type',
  'workflow',
  'component-workflow',
  'trait',
]);

/** Legacy-only types for apply (use POST /apply). */
const LEGACY_APPLY_KINDS = new Set([
  'Workflow',
  'ComponentType',
  'ComponentWorkflow',
  'Trait',
]);

/**
 * Maps CRD kinds to their new API PUT endpoint builder.
 * Returns { path, params, body } for client.PUT() call.
 */
function buildPutRequest(
  kind: string,
  name: string,
  ns: string,
  body: Record<string, unknown>,
): {
  path: string;
  params: { path: Record<string, string> };
  body: unknown;
} | null {
  // Strip apiVersion and kind — new API expects { metadata, spec }
  const { apiVersion: _a, kind: _k, ...rest } = body;

  switch (kind) {
    case 'Project':
      return {
        path: '/api/v1/namespaces/{namespaceName}/projects/{projectName}',
        params: { path: { namespaceName: ns, projectName: name } },
        body: rest,
      };
    case 'Component':
      return {
        path: '/api/v1/namespaces/{namespaceName}/components/{componentName}',
        params: { path: { namespaceName: ns, componentName: name } },
        body: rest,
      };
    case 'Environment':
      return {
        path: '/api/v1/namespaces/{namespaceName}/environments/{envName}',
        params: { path: { namespaceName: ns, envName: name } },
        body: rest,
      };
    case 'DataPlane':
      return {
        path: '/api/v1/namespaces/{namespaceName}/dataplanes/{dpName}',
        params: { path: { namespaceName: ns, dpName: name } },
        body: rest,
      };
    case 'BuildPlane':
      return {
        path: '/api/v1/namespaces/{namespaceName}/buildplanes/{bpName}',
        params: { path: { namespaceName: ns, bpName: name } },
        body: rest,
      };
    case 'ObservabilityPlane':
      return {
        path: '/api/v1/namespaces/{namespaceName}/observabilityplanes/{opName}',
        params: { path: { namespaceName: ns, opName: name } },
        body: rest,
      };
    case 'DeploymentPipeline':
      return {
        path: '/api/v1/namespaces/{namespaceName}/deployment-pipelines/{pipelineName}',
        params: { path: { namespaceName: ns, pipelineName: name } },
        body: rest,
      };
    case 'Workload':
      return {
        path: '/api/v1/namespaces/{namespaceName}/workloads/{workloadName}',
        params: { path: { namespaceName: ns, workloadName: name } },
        body: rest,
      };
    case 'SecretReference':
      return {
        path: '/api/v1/namespaces/{namespaceName}/secret-references/{secretRefName}',
        params: { path: { namespaceName: ns, secretRefName: name } },
        body: rest,
      };
    case 'ReleaseBinding':
      return {
        path: '/api/v1/namespaces/{namespaceName}/release-bindings/{bindingName}',
        params: { path: { namespaceName: ns, bindingName: name } },
        body: rest,
      };
    case 'NamespaceRole':
      return {
        path: '/api/v1/namespaces/{namespaceName}/roles/{name}',
        params: { path: { namespaceName: ns, name } },
        body: rest,
      };
    case 'NamespaceRoleBinding':
      return {
        path: '/api/v1/namespaces/{namespaceName}/rolebindings/{name}',
        params: { path: { namespaceName: ns, name } },
        body: rest,
      };
    case 'ClusterRole':
      return {
        path: '/api/v1/clusterroles/{name}',
        params: { path: { name } },
        body: rest,
      };
    case 'ClusterRoleBinding':
      return {
        path: '/api/v1/clusterrolebindings/{name}',
        params: { path: { name } },
        body: rest,
      };
    default:
      return null;
  }
}

export function registerCommands(
  context: vscode.ExtensionContext,
  authProvider: OccConfigAuthProvider,
  resourceExplorer: ResourceExplorerProvider,
  infrastructureExplorer: InfrastructureExplorerProvider,
  apiClientManager: ApiClientManager,
  deleteService: DeleteService,
  capabilityService: CapabilityService,
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
    vscode.commands.registerCommand('openchoreo.refreshResources', async () => {
      authProvider.loadConfig();
      const ctxInfo = authProvider.getContextInfo();
      await capabilityService.refresh(ctxInfo?.namespace);
      resourceExplorer.refresh();
    }),
  );

  // Refresh infrastructure
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.refreshInfrastructure',
      async () => {
        authProvider.loadConfig();
        const ctxInfo = authProvider.getContextInfo();
        await capabilityService.refresh(ctxInfo?.namespace);
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

  // Open resource — editable YAML for definition types, readonly JSON for others
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.openResource',
      async (node: ResourceNodeData) => {
        if (!node) {
          return;
        }

        // Definition resources open as editable YAML untitled documents
        if (DEFINITION_RESOURCE_TYPES.has(node.type)) {
          try {
            const crd = (await resourceContentProvider.fetchResourcePublic(
              node.type,
              node.namespace ?? null,
              node.project ?? null,
              node.component ?? null,
              node.resourceName ?? null,
            )) as Record<string, unknown>;

            const yamlContent = crdToYaml(crd);
            const doc = await vscode.workspace.openTextDocument({
              language: 'yaml',
              content: yamlContent,
            });
            await vscode.window.showTextDocument(doc);
          } catch (error) {
            vscode.window.showErrorMessage(
              `Failed to open resource: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
          }
          return;
        }

        // All other resources: readonly virtual JSON document
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

  // Delete resource with confirmation
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.deleteResource',
      async (node: ResourceNodeData) => {
        if (!node) {
          return;
        }

        const displayName = node.resourceName ?? node.label;
        const answer = await vscode.window.showWarningMessage(
          `Are you sure you want to delete ${node.type} '${displayName}'? This cannot be undone.`,
          { modal: true },
          'Delete',
        );

        if (answer !== 'Delete') {
          return;
        }

        try {
          await deleteService.deleteResource(node);
          vscode.window.showInformationMessage(
            `Deleted ${node.type} '${displayName}'.`,
          );
          resourceExplorer.refresh();
          infrastructureExplorer.refresh();
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to delete ${node.type} '${displayName}': ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      },
    ),
  );

  // Apply resource from active YAML editor to cluster
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.applyResource',
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage('No active editor.');
          return;
        }

        const content = editor.document.getText();
        let resource: Record<string, unknown>;
        try {
          resource = parseYaml(content) as Record<string, unknown>;
        } catch {
          vscode.window.showErrorMessage(
            'Failed to parse YAML. Fix syntax errors and try again.',
          );
          return;
        }

        if (
          resource?.apiVersion !== 'openchoreo.dev/v1alpha1' ||
          typeof resource?.kind !== 'string'
        ) {
          vscode.window.showErrorMessage(
            'Document must have apiVersion: openchoreo.dev/v1alpha1 and a kind field.',
          );
          return;
        }

        const kind = resource.kind as string;
        const metadata = resource.metadata as
          | { name?: string; namespace?: string }
          | undefined;
        const name = metadata?.name;
        const ns = metadata?.namespace ?? '';

        if (!name) {
          vscode.window.showErrorMessage(
            'Resource metadata.name is required.',
          );
          return;
        }

        try {
          // Legacy-only kinds use the legacy POST /apply endpoint
          if (LEGACY_APPLY_KINDS.has(kind)) {
            const legacyClient = await apiClientManager.getLegacyClient();
            if (!legacyClient) {
              vscode.window.showErrorMessage(
                'Not authenticated. Run "occ login" first.',
              );
              return;
            }

            const { error, response } = await legacyClient.POST('/apply', {
              body: resource,
            });

            if (error) {
              const msg =
                typeof error === 'object' && error !== null && 'message' in error
                  ? (error as { message: string }).message
                  : JSON.stringify(error);
              vscode.window.showErrorMessage(
                `Failed to apply resource: ${msg}`,
              );
              return;
            }

            const operation = response.status === 201 ? 'created' : 'updated';
            vscode.window.showInformationMessage(
              `${kind} '${name}' ${operation} successfully.`,
            );
          } else {
            // New API: route to per-resource PUT endpoint
            const client = await apiClientManager.getClient();
            if (!client) {
              vscode.window.showErrorMessage(
                'Not authenticated. Run "occ login" first.',
              );
              return;
            }

            const putReq = buildPutRequest(kind, name, ns, resource);
            if (!putReq) {
              vscode.window.showErrorMessage(
                `Unknown resource kind: ${kind}. Cannot determine API endpoint.`,
              );
              return;
            }

            // Use the generic PUT method with computed path
            const { error } = await client.PUT(putReq.path as never, {
              params: putReq.params,
              body: putReq.body,
            } as never);

            if (error) {
              const msg =
                typeof error === 'object' && error !== null && 'message' in error
                  ? (error as { message: string }).message
                  : JSON.stringify(error);
              vscode.window.showErrorMessage(
                `Failed to apply resource: ${msg}`,
              );
              return;
            }

            vscode.window.showInformationMessage(
              `${kind} '${name}' updated successfully.`,
            );
          }

          resourceExplorer.refresh();
          infrastructureExplorer.refresh();
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to apply resource: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      },
    ),
  );

  // Create new resource from scaffold
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.createResource',
      async () => {
        const kinds = Object.keys(CRD_KIND_TO_SCAFFOLD);
        const selected = await vscode.window.showQuickPick(kinds, {
          placeHolder: 'Select resource kind to create',
        });

        if (!selected) {
          return;
        }

        let scaffold = CRD_KIND_TO_SCAFFOLD[selected];
        if (!scaffold) {
          return;
        }

        // Replace namespace placeholder with current context namespace
        const ctxInfo = authProvider.getContextInfo();
        const ns = ctxInfo?.namespace ?? 'default';
        scaffold = scaffold.replace(/\{\{namespace\}\}/g, ns);

        const doc = await vscode.workspace.openTextDocument({
          language: 'yaml',
          content: scaffold,
        });
        await vscode.window.showTextDocument(doc);
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
 * Virtual document provider that fetches OpenChoreo resources via typed API clients
 * and presents them as readonly JSON documents.
 */
class OpenChoreoResourceProvider
  implements vscode.TextDocumentContentProvider
{
  private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(private readonly apiClientManager: ApiClientManager) {}

  /**
   * Public access to fetchResource for use by the openResource command
   * when opening definition resources as editable YAML.
   */
  async fetchResourcePublic(
    type: string | null,
    ns: string | null,
    proj: string | null,
    comp: string | null,
    name: string | null,
  ): Promise<unknown> {
    return this.fetchResource(type, ns, proj, comp, name);
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const params = new URLSearchParams(uri.query);
    const type = params.get('type');
    const ns = params.get('ns');
    const proj = params.get('proj');
    const comp = params.get('comp');
    const name = params.get('name');

    try {
      const payload = await this.fetchResource(type, ns, proj, comp, name);
      return JSON.stringify(payload, null, 2);
    } catch (error) {
      return `// Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private async fetchResource(
    type: string | null,
    ns: string | null,
    _proj: string | null,
    _comp: string | null,
    name: string | null,
  ): Promise<unknown> {
    // --- Legacy API types ---
    if (type && LEGACY_DEFINITION_TYPES.has(type)) {
      return this.fetchLegacyResource(type, ns, name);
    }

    // --- New API types ---
    return this.fetchNewApiResource(type, ns, name);
  }

  /** Fetch resources that use legacy API endpoints. */
  private async fetchLegacyResource(
    type: string,
    ns: string | null,
    name: string | null,
  ): Promise<unknown> {
    const legacyClient = await this.requireLegacyClient();

    if (type === 'namespace' && ns) {
      const { data, error } = await legacyClient.GET(
        '/namespaces/{namespaceName}',
        { params: { path: { namespaceName: ns } } },
      );
      if (error) {
        throw new Error(`Failed to fetch namespace: ${JSON.stringify(error)}`);
      }
      return data?.data ?? data;
    }

    // Definition types: component-type, workflow, component-workflow, trait
    // These use legacy GET /namespaces/{ns}/{type-plural}/{name}/definition
    if (ns && name) {
      switch (type) {
        case 'component-type': {
          const { data, error } = await legacyClient.GET(
            '/namespaces/{namespaceName}/component-types/{ctName}/definition',
            { params: { path: { namespaceName: ns, ctName: name } } },
          );
          if (error) {
            throw new Error(`Failed to fetch component type: ${JSON.stringify(error)}`);
          }
          return data?.data ?? data;
        }
        case 'workflow': {
          const { data, error } = await legacyClient.GET(
            '/namespaces/{namespaceName}/workflows/{workflowName}/definition',
            { params: { path: { namespaceName: ns, workflowName: name } } },
          );
          if (error) {
            throw new Error(`Failed to fetch workflow: ${JSON.stringify(error)}`);
          }
          return data?.data ?? data;
        }
        case 'component-workflow': {
          const { data, error } = await legacyClient.GET(
            '/namespaces/{namespaceName}/component-workflows/{cwName}/definition',
            { params: { path: { namespaceName: ns, cwName: name } } },
          );
          if (error) {
            throw new Error(`Failed to fetch component workflow: ${JSON.stringify(error)}`);
          }
          return data?.data ?? data;
        }
        case 'trait': {
          const { data, error } = await legacyClient.GET(
            '/namespaces/{namespaceName}/traits/{traitName}/definition',
            { params: { path: { namespaceName: ns, traitName: name } } },
          );
          if (error) {
            throw new Error(`Failed to fetch trait: ${JSON.stringify(error)}`);
          }
          return data?.data ?? data;
        }
      }
    }

    throw new Error(`Unknown legacy resource type: ${type}`);
  }

  /** Fetch resources using the new API endpoints. */
  private async fetchNewApiResource(
    type: string | null,
    ns: string | null,
    name: string | null,
  ): Promise<unknown> {
    const client = await this.requireClient();

    if (!type) {
      throw new Error('Resource type is required');
    }

    switch (type) {
      case 'project': {
        if (!ns || !name) {
          throw new Error('Namespace and name required for project');
        }
        const { data, error } = await client.GET(
          '/api/v1/namespaces/{namespaceName}/projects/{projectName}',
          { params: { path: { namespaceName: ns, projectName: name } } },
        );
        if (error) {
          throw new Error(`Failed to fetch project: ${JSON.stringify(error)}`);
        }
        return data;
      }
      case 'component': {
        if (!ns || !name) {
          throw new Error('Namespace and name required for component');
        }
        const { data, error } = await client.GET(
          '/api/v1/namespaces/{namespaceName}/components/{componentName}',
          { params: { path: { namespaceName: ns, componentName: name } } },
        );
        if (error) {
          throw new Error(`Failed to fetch component: ${JSON.stringify(error)}`);
        }
        return data;
      }
      case 'environment': {
        if (!ns || !name) {
          throw new Error('Namespace and name required for environment');
        }
        const { data, error } = await client.GET(
          '/api/v1/namespaces/{namespaceName}/environments/{envName}',
          { params: { path: { namespaceName: ns, envName: name } } },
        );
        if (error) {
          throw new Error(`Failed to fetch environment: ${JSON.stringify(error)}`);
        }
        return data;
      }
      case 'data-plane': {
        if (!ns || !name) {
          throw new Error('Namespace and name required for data plane');
        }
        const { data, error } = await client.GET(
          '/api/v1/namespaces/{namespaceName}/dataplanes/{dpName}',
          { params: { path: { namespaceName: ns, dpName: name } } },
        );
        if (error) {
          throw new Error(`Failed to fetch data plane: ${JSON.stringify(error)}`);
        }
        return data;
      }
      case 'build-plane': {
        if (!ns || !name) {
          throw new Error('Namespace and name required for build plane');
        }
        const { data, error } = await client.GET(
          '/api/v1/namespaces/{namespaceName}/buildplanes/{bpName}',
          { params: { path: { namespaceName: ns, bpName: name } } },
        );
        if (error) {
          throw new Error(`Failed to fetch build plane: ${JSON.stringify(error)}`);
        }
        return data;
      }
      case 'observability-plane': {
        if (!ns || !name) {
          throw new Error('Namespace and name required for observability plane');
        }
        const { data, error } = await client.GET(
          '/api/v1/namespaces/{namespaceName}/observabilityplanes/{opName}',
          { params: { path: { namespaceName: ns, opName: name } } },
        );
        if (error) {
          throw new Error(`Failed to fetch observability plane: ${JSON.stringify(error)}`);
        }
        return data;
      }
      case 'deployment-pipeline': {
        if (!ns || !name) {
          throw new Error('Namespace and name required for deployment pipeline');
        }
        const { data, error } = await client.GET(
          '/api/v1/namespaces/{namespaceName}/deployment-pipelines/{pipelineName}',
          { params: { path: { namespaceName: ns, pipelineName: name } } },
        );
        if (error) {
          throw new Error(`Failed to fetch deployment pipeline: ${JSON.stringify(error)}`);
        }
        return data;
      }
      case 'workload': {
        if (!ns || !name) {
          throw new Error('Namespace and name required for workload');
        }
        const { data, error } = await client.GET(
          '/api/v1/namespaces/{namespaceName}/workloads/{workloadName}',
          { params: { path: { namespaceName: ns, workloadName: name } } },
        );
        if (error) {
          throw new Error(`Failed to fetch workload: ${JSON.stringify(error)}`);
        }
        return data;
      }
      case 'secret-reference': {
        if (!ns || !name) {
          throw new Error('Namespace and name required for secret reference');
        }
        const { data, error } = await client.GET(
          '/api/v1/namespaces/{namespaceName}/secret-references/{secretRefName}',
          { params: { path: { namespaceName: ns, secretRefName: name } } },
        );
        if (error) {
          throw new Error(`Failed to fetch secret reference: ${JSON.stringify(error)}`);
        }
        return data;
      }
      case 'workflow-run': {
        if (!ns || !name) {
          throw new Error('Namespace and name required for workflow run');
        }
        const { data, error } = await client.GET(
          '/api/v1/namespaces/{namespaceName}/component-workflow-runs/{runName}',
          { params: { path: { namespaceName: ns, runName: name } } },
        );
        if (error) {
          throw new Error(`Failed to fetch workflow run: ${JSON.stringify(error)}`);
        }
        return data;
      }
      case 'component-release': {
        if (!ns || !name) {
          throw new Error('Namespace and name required for component release');
        }
        const { data, error } = await client.GET(
          '/api/v1/namespaces/{namespaceName}/component-releases/{releaseName}',
          { params: { path: { namespaceName: ns, releaseName: name } } },
        );
        if (error) {
          throw new Error(`Failed to fetch component release: ${JSON.stringify(error)}`);
        }
        return data;
      }
      case 'release-binding': {
        if (!ns || !name) {
          throw new Error('Namespace and name required for release binding');
        }
        const { data, error } = await client.GET(
          '/api/v1/namespaces/{namespaceName}/release-bindings/{bindingName}',
          { params: { path: { namespaceName: ns, bindingName: name } } },
        );
        if (error) {
          throw new Error(`Failed to fetch release binding: ${JSON.stringify(error)}`);
        }
        return data;
      }
      case 'namespace-role': {
        if (!ns || !name) {
          throw new Error('Namespace and name required for namespace role');
        }
        const { data, error } = await client.GET(
          '/api/v1/namespaces/{namespaceName}/roles/{name}',
          { params: { path: { namespaceName: ns, name } } },
        );
        if (error) {
          throw new Error(`Failed to fetch namespace role: ${JSON.stringify(error)}`);
        }
        return data;
      }
      case 'namespace-role-binding': {
        if (!ns || !name) {
          throw new Error('Namespace and name required for namespace role binding');
        }
        const { data, error } = await client.GET(
          '/api/v1/namespaces/{namespaceName}/rolebindings/{name}',
          { params: { path: { namespaceName: ns, name } } },
        );
        if (error) {
          throw new Error(`Failed to fetch namespace role binding: ${JSON.stringify(error)}`);
        }
        return data;
      }
      case 'cluster-role': {
        if (!name) {
          throw new Error('Name required for cluster role');
        }
        const { data, error } = await client.GET(
          '/api/v1/clusterroles/{name}',
          { params: { path: { name } } },
        );
        if (error) {
          throw new Error(`Failed to fetch cluster role: ${JSON.stringify(error)}`);
        }
        return data;
      }
      case 'cluster-role-binding': {
        if (!name) {
          throw new Error('Name required for cluster role binding');
        }
        const { data, error } = await client.GET(
          '/api/v1/clusterrolebindings/{name}',
          { params: { path: { name } } },
        );
        if (error) {
          throw new Error(`Failed to fetch cluster role binding: ${JSON.stringify(error)}`);
        }
        return data;
      }
      default:
        throw new Error(`Unknown resource type: ${type}`);
    }
  }

  private async requireClient(): Promise<Client> {
    const client = await this.apiClientManager.getClient();
    if (!client) {
      throw new Error('Not authenticated. Run "occ login" first.');
    }
    return client;
  }

  private async requireLegacyClient(): Promise<LegacyClient> {
    const client = await this.apiClientManager.getLegacyClient();
    if (!client) {
      throw new Error('Not authenticated. Run "occ login" first.');
    }
    return client;
  }
}

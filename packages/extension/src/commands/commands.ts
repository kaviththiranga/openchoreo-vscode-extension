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
import { CRD_KIND_TO_SCAFFOLD, crdToYaml } from '../services/yamlService';
import { ResourceService } from '../services/resourceService';
import { buildPutRequest, fetchResource } from '../services/apiRoutes';
import type { ComponentService } from '../services/componentService';
import type { WorkflowRunService } from '../services/workflowRunService';
import type { ReleaseBindingService } from '../services/releaseBindingService';
import type { LogOutputService } from '../services/logOutputService';
import type { SidebarViewProvider } from '../webview/sidebarViewProvider';
import {
  buildResourceUri,
  FS_SCHEME,
  type OpenChoreoFileSystemProvider,
} from '../filesystem/fileSystemProvider';

/**
 * Resolve a command argument into a ResourceNodeData.
 * Works for both native tree view items and webview context menu contexts.
 */
function resolveNode(
  arg: unknown,
  sidebarProvider?: SidebarViewProvider,
): ResourceNodeData | undefined {
  if (!arg || typeof arg !== 'object') return undefined;
  const obj = arg as Record<string, unknown>;
  // Native tree view: has childrenMode (ResourceNodeData property)
  if ('childrenMode' in obj) return obj as unknown as ResourceNodeData;
  // Webview context menu: has nodeId set via data-vscode-context
  if ('nodeId' in obj && typeof obj.nodeId === 'string' && sidebarProvider) {
    return sidebarProvider.getNode(obj.nodeId);
  }
  return undefined;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  authProvider: OccConfigAuthProvider,
  resourceExplorer: ResourceExplorerProvider,
  infrastructureExplorer: InfrastructureExplorerProvider,
  apiClientManager: ApiClientManager,
  deleteService: DeleteService,
  capabilityService: CapabilityService,
  fsProvider: OpenChoreoFileSystemProvider,
  componentService: ComponentService,
  workflowRunService: WorkflowRunService,
  releaseBindingService: ReleaseBindingService,
  logOutputService: LogOutputService,
  sidebarProvider?: SidebarViewProvider,
): void {
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

  // Switch context, then prompt for namespace
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

        const currentCtx = authProvider.getContextInfo()?.contextName;
        const items = contexts.map((name) => ({
          label: name,
          description: name === currentCtx ? '(current)' : undefined,
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select OpenChoreo context',
        });

        if (!selected || selected.label === currentCtx) return;

        authProvider.switchContext(selected.label);
        vscode.window.showInformationMessage(
          `Switched to context: ${selected.label}`,
        );

        // Follow up with namespace selection
        await vscode.commands.executeCommand('openchoreo.selectNamespace');
      },
    ),
  );

  // Login prompt — reuse existing terminal to prevent multiple concurrent login flows
  let loginTerminal: vscode.Terminal | undefined;
  context.subscriptions.push(
    vscode.commands.registerCommand('openchoreo.login', () => {
      if (loginTerminal && vscode.window.terminals.includes(loginTerminal)) {
        loginTerminal.show();
        return;
      }
      loginTerminal = vscode.window.createTerminal('OpenChoreo Login');
      loginTerminal.show();
      loginTerminal.sendText('occ login');
    }),
  );
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((t) => {
      if (t === loginTerminal) loginTerminal = undefined;
    }),
  );

  // Open K8s resource definition as read-only YAML via virtual filesystem
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.openK8sDefinition',
      async (arg: unknown) => {
        const node = resolveNode(arg, sidebarProvider);
        if (!node?.extra?.objectYaml || !node?.extra?.kind || !node?.resourceName) return;
        try {
          const k8sType = `k8s-${node.extra.kind.toLowerCase()}`;
          const path = node.namespace
            ? `/namespaces/${node.namespace}/${k8sType}/${node.resourceName}.yaml`
            : `/${k8sType}/${node.resourceName}.yaml`;
          const uri = vscode.Uri.from({
            scheme: FS_SCHEME,
            path,
            query: 'readonly',
          });
          fsProvider.setReadonlyContent(uri, node.extra.objectYaml);
          const doc = await vscode.workspace.openTextDocument(uri);
          if (doc.languageId !== 'yaml') {
            await vscode.languages.setTextDocumentLanguage(doc, 'yaml');
          }
          await vscode.window.showTextDocument(doc);
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to open definition: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      },
    ),
  );

  // Open resource via the virtual filesystem
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.openResource',
      async (arg: unknown) => {
        const node = resolveNode(arg, sidebarProvider);
        if (!node) {
          return;
        }

        try {
          const uri = buildResourceUri(node);
          const doc = await vscode.workspace.openTextDocument(uri);
          // Force YAML language for custom scheme documents
          if (doc.languageId !== 'yaml') {
            await vscode.languages.setTextDocumentLanguage(doc, 'yaml');
          }
          await vscode.window.showTextDocument(doc);
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to open resource: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      },
    ),
  );

  // Add lightweight resource reference to chat
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.addToChat',
      async (arg: unknown) => {
        const node = resolveNode(arg, sidebarProvider);
        if (!node) return;
        const name = node.resourceName ?? node.label;
        const kind = new ResourceService().getCrdKind(node.type) ?? node.type;
        let ref = `Regarding OpenChoreo ${kind} "${name}"`;
        if (node.project && node.project !== name) ref += ` in Project "${node.project}"`;
        if (node.namespace) ref += ` in Namespace "${node.namespace}"`;

        try {
          await vscode.commands.executeCommand('workbench.action.chat.open', {
            query: `${ref}: `,
            isPartialQuery: true,
          });
        } catch {
          vscode.window.showInformationMessage(`Chat not available.`);
        }
      },
    ),
  );

  // Add full resource YAML to chat
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.addYamlToChat',
      async (arg: unknown) => {
        const node = resolveNode(arg, sidebarProvider);
        if (!node) return;
        const name = node.resourceName ?? node.label;
        const kind = new ResourceService().getCrdKind(node.type) ?? node.type;
        let ref = `Regarding OpenChoreo ${kind} "${name}"`;
        if (node.project && node.project !== name) ref += ` in Project "${node.project}"`;
        if (node.namespace) ref += ` in Namespace "${node.namespace}"`;

        try {
          const client = await apiClientManager.getClient();
          if (!client) {
            vscode.window.showWarningMessage('Not authenticated.');
            return;
          }

          const data = await fetchResource(
            client,
            node.type,
            node.namespace ?? null,
            name,
          );

          if (data) {
            const crd = data as Record<string, unknown>;
            if (!crd.apiVersion) {
              crd.apiVersion = 'openchoreo.dev/v1alpha1';
              crd.kind = kind;
            }
            const yaml = crdToYaml(crd);

            await vscode.commands.executeCommand('workbench.action.chat.open', {
              query: `${ref}:\n\`\`\`yaml\n${yaml}\`\`\`\n`,
              isPartialQuery: true,
            });
          }
        } catch (err) {
          vscode.window.showErrorMessage(
            `Failed to fetch resource: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        }
      },
    ),
  );

  // Generate an immutable release snapshot from a component
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.generateRelease',
      async (arg: unknown) => {
        const node = resolveNode(arg, sidebarProvider);
        if (!node?.namespace || !node?.component) return;

        const releaseName = await vscode.window.showInputBox({
          prompt: 'Enter release name (leave empty to auto-generate)',
          placeHolder: 'e.g., v1.0.0',
        });
        if (releaseName === undefined) return; // Escape pressed

        try {
          const release = await componentService.generateRelease(
            node.namespace,
            node.component,
            releaseName || undefined,
          );
          const name = release?.metadata?.name ?? 'unknown';
          vscode.window.showInformationMessage(
            `Release '${name}' generated for component '${node.component}'.`,
          );
          resourceExplorer.refresh();
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to generate release: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      },
    ),
  );

  // Trigger a workflow run for a component
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.triggerBuild',
      async (arg: unknown) => {
        const node = resolveNode(arg, sidebarProvider);
        if (!node?.namespace || !node?.component) return;

        try {
          const client = await apiClientManager.getClient();
          if (!client) {
            vscode.window.showWarningMessage('Not authenticated.');
            return;
          }

          const ns = node.namespace;
          const [nsWorkflows, clusterWorkflows] = await Promise.all([
            client.GET('/api/v1/namespaces/{namespaceName}/workflows', {
              params: { path: { namespaceName: ns } },
            }),
            client.GET('/api/v1/clusterworkflows'),
          ]);

          const items: Array<
            vscode.QuickPickItem & { workflowKind: string }
          > = [];
          for (const w of nsWorkflows.data?.items ?? []) {
            const name = w.metadata?.name as string;
            if (name) items.push({ label: name, description: 'Workflow', workflowKind: 'Workflow' });
          }
          for (const w of clusterWorkflows.data?.items ?? []) {
            const name = w.metadata?.name as string;
            if (name) items.push({ label: name, description: 'ClusterWorkflow', workflowKind: 'ClusterWorkflow' });
          }

          if (items.length === 0) {
            vscode.window.showWarningMessage('No workflows available.');
            return;
          }

          const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select workflow to trigger',
          });
          if (!selected) return;

          const runName = `${node.component}-${selected.label}-${Date.now()}`;
          await workflowRunService.createWorkflowRun(ns, {
            metadata: {
              name: runName,
              namespace: ns,
              labels: {
                'openchoreo.dev/project': node.project ?? '',
                'openchoreo.dev/component': node.component,
              },
            },
            spec: {
              workflow: {
                kind: selected.workflowKind,
                name: selected.label,
              },
            },
          });

          vscode.window.showInformationMessage(
            `Workflow run '${runName}' triggered.`,
          );
          resourceExplorer.refresh();
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to trigger build: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      },
    ),
  );

  // View workflow run logs — live streaming
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.viewWorkflowRunLogs',
      (arg: unknown) => {
        const node = resolveNode(arg, sidebarProvider);
        if (!node?.namespace || !node?.resourceName) return;
        const ns = node.namespace;
        const name = node.resourceName;
        logOutputService.startStreaming(
          `OpenChoreo: Logs - ${name}`,
          async () => {
            const logs = await workflowRunService.getLogs(ns, name);
            return logs.map((e: { timestamp?: string; log: string }) => {
              const prefix = e.timestamp ? `[${e.timestamp}] ` : '';
              return `${prefix}${e.log}`;
            });
          },
          { emptyMessage: 'No logs available yet. Waiting for new entries...' },
        );
      },
    ),
  );

  // View workflow run events — live streaming
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.viewWorkflowRunEvents',
      (arg: unknown) => {
        const node = resolveNode(arg, sidebarProvider);
        if (!node?.namespace || !node?.resourceName) return;
        const ns = node.namespace;
        const name = node.resourceName;
        logOutputService.startStreaming(
          `OpenChoreo: Events - ${name}`,
          async () => {
            const events = await workflowRunService.getEvents(ns, name);
            return events.map((ev: { timestamp: string; type: string; reason: string; message: string }) => {
              const ts = ev.timestamp ? `[${ev.timestamp}] ` : '';
              return `${ts}${ev.type} ${ev.reason}: ${ev.message}`;
            });
          },
          { emptyMessage: 'No events recorded for this workflow run.' },
        );
      },
    ),
  );

  // View step-level workflow run logs — filtered by task name
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.viewStepLogs',
      (arg: unknown) => {
        const node = resolveNode(arg, sidebarProvider);
        if (!node?.namespace || !node?.resourceName || !node?.extra?.taskName) return;
        const ns = node.namespace;
        const runName = node.resourceName;
        const task = node.extra.taskName;
        logOutputService.startStreaming(
          `OpenChoreo: Logs - ${runName}/${task}`,
          async () => {
            const logs = await workflowRunService.getLogs(ns, runName, task);
            return logs.map((e: { timestamp?: string; log: string }) => {
              const prefix = e.timestamp ? `[${e.timestamp}] ` : '';
              return `${prefix}${e.log}`;
            });
          },
          { emptyMessage: `No logs available for step "${task}" yet.` },
        );
      },
    ),
  );

  // View step-level workflow run events — filtered by task name
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.viewStepEvents',
      (arg: unknown) => {
        const node = resolveNode(arg, sidebarProvider);
        if (!node?.namespace || !node?.resourceName || !node?.extra?.taskName) return;
        const ns = node.namespace;
        const runName = node.resourceName;
        const task = node.extra.taskName;
        logOutputService.startStreaming(
          `OpenChoreo: Events - ${runName}/${task}`,
          async () => {
            const events = await workflowRunService.getEvents(ns, runName, task);
            return events.map((ev: { timestamp: string; type: string; reason: string; message: string }) => {
              const ts = ev.timestamp ? `[${ev.timestamp}] ` : '';
              return `${ts}${ev.type} ${ev.reason}: ${ev.message}`;
            });
          },
          { emptyMessage: `No events for step "${task}".` },
        );
      },
    ),
  );

  // View K8s pod logs — live streaming
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.viewK8sResourceLogs',
      (arg: unknown) => {
        const node = resolveNode(arg, sidebarProvider);
        if (!node?.namespace || !node?.extra?.releaseBindingName || !node?.resourceName) return;
        const ns = node.namespace;
        const rbName = node.extra.releaseBindingName;
        const podName = node.resourceName;
        logOutputService.startStreaming(
          `OpenChoreo: Pod Logs - ${podName}`,
          async () => {
            const entries = await releaseBindingService.getK8sResourceLogs(ns, rbName, podName);
            return entries.map((e) => {
              const prefix = e.timestamp ? `[${e.timestamp}] ` : '';
              return `${prefix}${e.log}`;
            });
          },
          { emptyMessage: 'No logs from this pod yet.' },
        );
      },
    ),
  );

  // View K8s resource events — live streaming
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.viewK8sResourceEvents',
      (arg: unknown) => {
        const node = resolveNode(arg, sidebarProvider);
        if (!node?.namespace || !node?.extra) return;
        const { releaseBindingName, group, version, kind } = node.extra;
        if (!releaseBindingName || !version || !kind || !node.resourceName) return;
        const ns = node.namespace;
        const name = node.resourceName;
        logOutputService.startStreaming(
          `OpenChoreo: Events - ${kind}/${name}`,
          async () => {
            const events = await releaseBindingService.getK8sResourceEvents(
              ns, releaseBindingName, { group, version, kind, name },
            );
            return events.map((ev) => {
              const ts = ev.lastTimestamp ?? ev.firstTimestamp ?? '';
              const tsPrefix = ts ? `[${ts}] ` : '';
              const cnt = ev.count && ev.count > 1 ? ` (x${ev.count})` : '';
              return `${tsPrefix}${ev.type} ${ev.reason}${cnt}: ${ev.message}`;
            });
          },
          { emptyMessage: 'No events for this resource.' },
        );
      },
    ),
  );

  // Delete resource with confirmation
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.deleteResource',
      async (arg: unknown) => {
        const node = resolveNode(arg, sidebarProvider);
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

  // Apply resource from active YAML editor to cluster (for untitled documents / scaffolds)
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
            `${kind} '${name}' applied successfully.`,
          );

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

  // Create resource scoped to Developer Resources (Project, Component)
  const DEV_KINDS = ['Project', 'Component'];
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.createDevResource',
      async () => {
        const selected = await vscode.window.showQuickPick(DEV_KINDS, {
          placeHolder: 'Select resource kind to create',
        });
        if (!selected) return;
        const ctxInfo = authProvider.getContextInfo();
        openScaffold(selected, fsProvider, ctxInfo?.namespace, ctxInfo?.project);
      },
    ),
  );

  // Create resource scoped to Platform Resources (namespace-scoped infra)
  const INFRA_KINDS = Object.keys(CRD_KIND_TO_SCAFFOLD).filter(
    (k) => !DEV_KINDS.includes(k) && !k.startsWith('Cluster'),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.createInfraResource',
      async () => {
        const selected = await vscode.window.showQuickPick(INFRA_KINDS, {
          placeHolder: 'Select resource kind to create',
        });
        if (!selected) return;
        const ctxInfo = authProvider.getContextInfo();
        openScaffold(selected, fsProvider, ctxInfo?.namespace);
      },
    ),
  );

  // Create resource scoped to Cluster Resources (cluster-scoped scaffolds, no namespace)
  const CLUSTER_KINDS = ['ClusterComponentType', 'ClusterWorkflow', 'ClusterTrait', 'ClusterDataPlane', 'ClusterWorkflowPlane', 'ClusterObservabilityPlane'];
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.createClusterResource',
      async () => {
        const selected = await vscode.window.showQuickPick(CLUSTER_KINDS, {
          placeHolder: 'Select cluster resource kind to create',
        });
        if (!selected) return;
        openScaffold(selected, fsProvider);
      },
    ),
  );

  // Create component from project node (inline "+" button)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.createComponent',
      async (arg: unknown) => {
        const node = resolveNode(arg, sidebarProvider);
        if (!node) return;
        const ctxInfo = authProvider.getContextInfo();
        const ns = node.namespace ?? ctxInfo?.namespace;
        openScaffold('Component', fsProvider, ns, node.project);
      },
    ),
  );

  // Create child resource from tree item context (inline "+" button on infra categories)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.createChildResource',
      async (arg: unknown) => {
        const node = resolveNode(arg, sidebarProvider);
        if (!node) {
          return;
        }

        const ctxInfo = authProvider.getContextInfo();
        const ns = node.namespace ?? ctxInfo?.namespace;

        if (node.type === 'infra-category' && node.lazyChildrenKey) {
          // Infrastructure category → create the matching kind
          const kindMap: Record<string, string> = {
            // Namespace-scoped
            'environments': 'Environment',
            'data-planes': 'DataPlane',
            'workflow-planes': 'WorkflowPlane',
            'component-types': 'ComponentType',
            'workflows': 'Workflow',
            'traits': 'Trait',
            'secret-references': 'SecretReference',
            'observability-planes': 'ObservabilityPlane',
            // Cluster-scoped
            'cluster-component-types': 'ClusterComponentType',
            'cluster-workflows': 'ClusterWorkflow',
            'cluster-traits': 'ClusterTrait',
            'cluster-data-planes': 'ClusterDataPlane',
            'cluster-workflow-planes': 'ClusterWorkflowPlane',
            'cluster-observability-planes': 'ClusterObservabilityPlane',
          };
          const kind = kindMap[node.lazyChildrenKey];
          if (kind) {
            openScaffold(kind, fsProvider, ns);
          }
          return;
        }

        // Fallback: generic picker
        const kinds = Object.keys(CRD_KIND_TO_SCAFFOLD);
        const selected = await vscode.window.showQuickPick(kinds, {
          placeHolder: 'Select resource kind to create',
        });
        if (selected) {
          openScaffold(selected, fsProvider, ns, node.project);
        }
      },
    ),
  );
}

/** Open a scaffold YAML on the openchoreo:// filesystem so Cmd+S creates on cluster. */
async function openScaffold(
  kind: string,
  provider: OpenChoreoFileSystemProvider,
  namespace?: string,
  project?: string,
): Promise<void> {
  let scaffold = CRD_KIND_TO_SCAFFOLD[kind];
  if (!scaffold) {
    return;
  }

  const isCluster = kind.startsWith('Cluster');
  const ns = namespace ?? 'default';
  scaffold = scaffold.replace(/\{\{namespace\}\}/g, ns);
  scaffold = scaffold.replace(/\{\{project\}\}/g, project ?? 'default');

  // Build a URI with a unique counter to support multiple new resources
  const counter = (openScaffold as { _counter?: number })._counter =
    ((openScaffold as { _counter?: number })._counter ?? 0) + 1;
  const placeholderName = `new-${kind.toLowerCase()}-${counter}`;
  const nodeType = kindToNodeType(kind);
  const path = isCluster
    ? `/${nodeType}/${placeholderName}.yaml`
    : `/namespaces/${ns}/${nodeType}/${placeholderName}.yaml`;
  const uri = vscode.Uri.from({
    scheme: FS_SCHEME,
    path,
  });

  // Store empty content for readFile — the scaffold is applied via edit
  // so VSCode treats the document as dirty (unsaved).
  provider.setPendingContent(uri, '');

  const doc = await vscode.workspace.openTextDocument(uri);
  if (doc.languageId !== 'yaml') {
    await vscode.languages.setTextDocumentLanguage(doc, 'yaml');
  }
  const editor = await vscode.window.showTextDocument(doc);

  // Replace the empty content with the scaffold — this makes the doc dirty
  const fullRange = new vscode.Range(
    new vscode.Position(0, 0),
    doc.lineAt(doc.lineCount - 1).range.end,
  );
  await editor.edit((eb) => {
    eb.replace(fullRange, scaffold);
  });
}

/** Map CRD kind name to ResourceNodeType for URI construction. */
function kindToNodeType(kind: string): string {
  const map: Record<string, string> = {
    Project: 'project',
    Component: 'component',
    ComponentType: 'component-type',
    Trait: 'trait',
    Environment: 'environment',
    DataPlane: 'data-plane',
    WorkflowPlane: 'workflow-plane',
    Workflow: 'workflow',
    Workload: 'workload',
    DeploymentPipeline: 'deployment-pipeline',
    SecretReference: 'secret-reference',
    ObservabilityPlane: 'observability-plane',
    ClusterComponentType: 'cluster-component-type',
    ClusterWorkflow: 'cluster-workflow',
    ClusterTrait: 'cluster-trait',
    ClusterDataPlane: 'cluster-data-plane',
    ClusterWorkflowPlane: 'cluster-workflow-plane',
    ClusterObservabilityPlane: 'cluster-observability-plane',
  };
  return map[kind] ?? kind.toLowerCase();
}

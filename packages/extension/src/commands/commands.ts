// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { parse as parseYaml, stringify } from 'yaml';
import { OccConfigAuthProvider } from '../auth/authProvider';
import type { LoginRunner } from '../auth/loginRunner';
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
  loginRunner: LoginRunner,
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
  const CREATE_CTX_LABEL = '$(add) Create New Context...';

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.switchContext',
      async () => {
        const contexts = authProvider.getAvailableContexts();
        const currentCtx = authProvider.getContextInfo()?.contextName;

        const items: vscode.QuickPickItem[] = contexts.map((name) => ({
          label: name,
          description: name === currentCtx ? '(current)' : undefined,
        }));

        if (items.length > 0) {
          items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        }
        items.push({ label: CREATE_CTX_LABEL, alwaysShow: true });

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select OpenChoreo context',
        });

        if (!selected) return;

        if (selected.label === CREATE_CTX_LABEL) {
          await createContextViaLogin();
          return;
        }

        if (selected.label === currentCtx) return;

        authProvider.switchContext(selected.label);
        vscode.window.showInformationMessage(
          `Switched to context: ${selected.label}`,
        );

        // Follow up with namespace selection
        await vscode.commands.executeCommand('openchoreo.selectNamespace');
      },
    ),
  );

  async function createContextViaLogin(): Promise<void> {
    const ctxName = await vscode.window.showInputBox({
      prompt: 'Enter a name for the new context',
      placeHolder: 'e.g., my-cluster',
      validateInput: (value) => {
        if (!value) return 'Name is required';
        if (!/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(value)) {
          return 'Must be lowercase alphanumeric (hyphens, dots, underscores allowed)';
        }
        if (authProvider.getAvailableContexts().includes(value)) {
          return `Context '${value}' already exists`;
        }
        return undefined;
      },
    });
    if (!ctxName) return;

    const cpUrl = await vscode.window.showInputBox({
      prompt: 'Enter the control plane URL',
      placeHolder: 'e.g., https://api.openchoreo.example.com',
      validateInput: (value) => {
        if (!value) return 'URL is required';
        try {
          new URL(value);
          return undefined;
        } catch {
          return 'Must be a valid URL';
        }
      },
    });
    if (!cpUrl) return;

    loginRunner.start(['--context', ctxName, '--controlplane', cpUrl]);
  }

  // Login — spawns `occ login` as a managed child process and streams
  // output to the "OpenChoreo Login" Output Channel. The sidebar shows
  // "Waiting for browser…" while this runs.
  context.subscriptions.push(
    vscode.commands.registerCommand('openchoreo.login', () => {
      loginRunner.start();
    }),
  );

  // Reveal the login Output Channel — used by the "Open Output" link in
  // the sidebar's "logging in" view.
  context.subscriptions.push(
    vscode.commands.registerCommand('openchoreo.showLoginOutput', () => {
      loginRunner.showOutput();
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

  // Promote a release binding to the next environment in the pipeline
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.promoteBinding',
      async (arg: unknown) => {
        const node = resolveNode(arg, sidebarProvider);
        if (!node?.namespace || !node?.component || !node?.extra?.environment) return;

        try {
          const client = await apiClientManager.getClient();
          if (!client) { vscode.window.showWarningMessage('Not authenticated.'); return; }

          const targets = (node.extra.promotionTargets ?? '').split(',').filter(Boolean);
          if (targets.length === 0) {
            vscode.window.showWarningMessage('No promotion targets available for this environment.');
            return;
          }

          let targetEnv: string;
          if (targets.length === 1) {
            targetEnv = targets[0];
          } else {
            const picked = await vscode.window.showQuickPick(
              targets.map(t => ({ label: t })),
              { placeHolder: 'Select target environment' },
            );
            if (!picked) return;
            targetEnv = picked.label;
          }

          const releaseName = node.extra.releaseName;
          if (!releaseName) {
            vscode.window.showWarningMessage('No release deployed in this environment to promote.');
            return;
          }

          await openOrUpdateReleaseBinding(client, fsProvider, {
            namespace: node.namespace,
            project: node.project ?? '',
            component: node.component,
            environment: targetEnv,
            releaseName,
          });
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to promote: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      },
    ),
  );

  // Deploy a release to an inactive environment (from placeholder node)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.deployToEnv',
      async (arg: unknown) => {
        const node = resolveNode(arg, sidebarProvider);
        if (!node?.namespace || !node?.component || !node?.extra?.environment) return;

        try {
          const client = await apiClientManager.getClient();
          if (!client) { vscode.window.showWarningMessage('Not authenticated.'); return; }

          // Fetch available releases for this component
          const { data } = await client.GET(
            '/api/v1/namespaces/{namespaceName}/componentreleases',
            {
              params: {
                path: { namespaceName: node.namespace },
                query: { component: node.component },
              },
            },
          );
          const releases = (data?.items ?? [])
            .map(r => (r.metadata?.name as string))
            .filter(Boolean);

          if (releases.length === 0) {
            vscode.window.showWarningMessage('No releases available. Generate a release first.');
            return;
          }

          const picked = await vscode.window.showQuickPick(
            releases.map(r => ({ label: r })),
            { placeHolder: 'Select release to deploy' },
          );
          if (!picked) return;

          await openOrUpdateReleaseBinding(client, fsProvider, {
            namespace: node.namespace,
            project: node.project ?? '',
            component: node.component,
            environment: node.extra.environment,
            releaseName: picked.label,
          });
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to prepare deployment: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      },
    ),
  );

  // Deploy a release to a chosen environment (from release node context menu)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.deployRelease',
      async (arg: unknown) => {
        const node = resolveNode(arg, sidebarProvider);
        if (!node?.namespace || !node?.resourceName) return;

        try {
          const client = await apiClientManager.getClient();
          if (!client) { vscode.window.showWarningMessage('Not authenticated.'); return; }

          // Fetch environments from pipeline
          const { data: projectData } = await client.GET(
            '/api/v1/namespaces/{namespaceName}/projects/{projectName}',
            { params: { path: { namespaceName: node.namespace, projectName: node.project! } } },
          );
          const pipelineName = (projectData as { spec?: { deploymentPipelineRef?: { name?: string } } })
            ?.spec?.deploymentPipelineRef?.name;

          if (!pipelineName) {
            vscode.window.showWarningMessage('No deployment pipeline configured.');
            return;
          }

          const { data: pipelineData } = await client.GET(
            '/api/v1/namespaces/{namespaceName}/deploymentpipelines/{deploymentPipelineName}',
            { params: { path: { namespaceName: node.namespace, deploymentPipelineName: pipelineName } } },
          );
          const paths = (pipelineData as { spec?: { promotionPaths?: Array<{ sourceEnvironmentRef: { name: string }; targetEnvironmentRefs: Array<{ name: string }> }> } })
            ?.spec?.promotionPaths ?? [];

          const allEnvs = new Set<string>();
          for (const p of paths) {
            allEnvs.add(p.sourceEnvironmentRef.name);
            for (const t of p.targetEnvironmentRefs) allEnvs.add(t.name);
          }

          if (allEnvs.size === 0) {
            vscode.window.showWarningMessage('No environments found in pipeline.');
            return;
          }

          const picked = await vscode.window.showQuickPick(
            [...allEnvs].map(e => ({ label: e })),
            { placeHolder: 'Select environment to deploy to' },
          );
          if (!picked) return;

          await openOrUpdateReleaseBinding(client, fsProvider, {
            namespace: node.namespace,
            project: node.project ?? '',
            component: node.component ?? '',
            environment: picked.label,
            releaseName: node.resourceName,
          });
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to prepare deployment: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      },
    ),
  );

  // Trigger the component's configured workflow directly
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
          // Fetch the component to get its configured workflow
          const { data: comp, error: compErr } = await client.GET(
            '/api/v1/namespaces/{namespaceName}/components/{componentName}',
            { params: { path: { namespaceName: ns, componentName: node.component } } },
          );
          if (compErr || !comp) {
            vscode.window.showErrorMessage('Failed to fetch component.');
            return;
          }

          const wf = (comp as { spec?: { workflow?: { kind?: string; name?: string; parameters?: unknown } } })?.spec?.workflow;
          if (!wf?.name) {
            vscode.window.showWarningMessage('No workflow configured on this component.');
            return;
          }

          const runName = `${node.component}-${Date.now()}`;
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
                kind: wf.kind ?? 'ClusterWorkflow',
                name: wf.name,
                ...(wf.parameters ? { parameters: wf.parameters } : {}),
              },
            },
          });

          vscode.window.showInformationMessage(
            `Build triggered: '${runName}' using workflow '${wf.name}'.`,
          );
          resourceExplorer.refresh();
          sidebarProvider?.refreshAll();
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to trigger build: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      },
    ),
  );

  // Trigger build with custom parameters — opens WorkflowRun YAML editor
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.triggerBuildWithParams',
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
          const { data: comp, error: compErr } = await client.GET(
            '/api/v1/namespaces/{namespaceName}/components/{componentName}',
            { params: { path: { namespaceName: ns, componentName: node.component } } },
          );
          if (compErr || !comp) {
            vscode.window.showErrorMessage('Failed to fetch component.');
            return;
          }

          const wf = (comp as { spec?: { workflow?: { kind?: string; name?: string; parameters?: unknown } } })?.spec?.workflow;
          if (!wf?.name) {
            vscode.window.showWarningMessage('No workflow configured on this component.');
            return;
          }

          // Build the full WorkflowRun object and serialize to YAML
          const runObj: Record<string, unknown> = {
            apiVersion: 'openchoreo.dev/v1alpha1',
            kind: 'WorkflowRun',
            metadata: {
              name: `${node.component}-${Date.now()}`,
              namespace: ns,
              labels: {
                'openchoreo.dev/project': node.project ?? '',
                'openchoreo.dev/component': node.component,
              },
            },
            spec: {
              workflow: {
                kind: wf.kind ?? 'ClusterWorkflow',
                name: wf.name,
                ...(wf.parameters ? { parameters: wf.parameters } : {}),
              },
            },
          };
          const scaffold = stringify(runObj, { lineWidth: 0 });
          openScaffold('WorkflowRun', fsProvider, ns, undefined, scaffold);
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to prepare build: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      },
    ),
  );

  // Run a generic workflow (from Workflow/ClusterWorkflow tree items)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.runWorkflow',
      async (arg: unknown) => {
        const node = resolveNode(arg, sidebarProvider);
        if (!node?.resourceName) return;

        const ctxInfo = authProvider.getContextInfo();
        const ns = node.namespace ?? ctxInfo?.namespace ?? 'default';
        const isCluster = node.type === 'cluster-workflow';
        const kind = isCluster ? 'ClusterWorkflow' : 'Workflow';

        const scaffold = `apiVersion: openchoreo.dev/v1alpha1
kind: WorkflowRun
metadata:
  name: ${node.resourceName}-${Date.now()}
  namespace: "${ns}"
spec:
  workflow:
    kind: ${kind}
    name: ${node.resourceName}
    parameters: {}
`;
        openScaffold('WorkflowRun', fsProvider, ns, undefined, scaffold);
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
          sidebarProvider?.refreshAll();
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
            'namespace-roles': 'AuthzRole',
            'namespace-role-bindings': 'AuthzRoleBinding',
            // Cluster-scoped
            'cluster-component-types': 'ClusterComponentType',
            'cluster-workflows': 'ClusterWorkflow',
            'cluster-traits': 'ClusterTrait',
            'cluster-data-planes': 'ClusterDataPlane',
            'cluster-workflow-planes': 'ClusterWorkflowPlane',
            'cluster-observability-planes': 'ClusterObservabilityPlane',
            'cluster-roles': 'ClusterAuthzRole',
            'cluster-role-bindings': 'ClusterAuthzRoleBinding',
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
  customScaffold?: string,
): Promise<void> {
  let scaffold = customScaffold ?? CRD_KIND_TO_SCAFFOLD[kind];
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
    AuthzRole: 'namespace-role',
    AuthzRoleBinding: 'namespace-role-binding',
    ReleaseBinding: 'release-binding',
    WorkflowRun: 'workflow-run',
    ClusterAuthzRole: 'cluster-role',
    ClusterAuthzRoleBinding: 'cluster-role-binding',
  };
  return map[kind] ?? kind.toLowerCase();
}

type ApiClient = NonNullable<Awaited<ReturnType<ApiClientManager['getClient']>>>;

/**
 * Open or create a ReleaseBinding for a component+environment.
 * If a binding already exists, opens it with the releaseName updated.
 * If not, opens a new scaffold.
 */
async function openOrUpdateReleaseBinding(
  client: ApiClient,
  fsProvider: OpenChoreoFileSystemProvider,
  opts: {
    namespace: string;
    project: string;
    component: string;
    environment: string;
    releaseName: string;
  },
): Promise<void> {
  const { namespace: ns, project, component, environment, releaseName } = opts;

  // Check if a binding already exists for this component+environment
  const { data } = await client.GET(
    '/api/v1/namespaces/{namespaceName}/releasebindings',
    { params: { path: { namespaceName: ns }, query: { component } } },
  );
  const existing = (data?.items ?? []).find(
    (b) => (b as { spec?: { environment?: string } }).spec?.environment === environment,
  );

  if (existing) {
    // Open the existing binding with updated releaseName
    const existingName = (existing.metadata?.name as string) ?? '';
    const crd = existing as Record<string, unknown>;
    // Update the releaseName in the spec
    if (crd.spec && typeof crd.spec === 'object') {
      (crd.spec as Record<string, unknown>).releaseName = releaseName;
    }
    // Open via the virtual filesystem — this fetches from API, but we want the modified version
    const uri = vscode.Uri.from({
      scheme: FS_SCHEME,
      path: `/namespaces/${ns}/release-binding/${existingName}.yaml`,
    });
    // Inject apiVersion/kind if missing
    if (!crd.apiVersion) {
      crd.apiVersion = 'openchoreo.dev/v1alpha1';
      crd.kind = 'ReleaseBinding';
    }
    const yamlContent = stringify(crd, { lineWidth: 0 });
    // Use setReadonlyContent (not setPendingContent) to avoid marking as new — Cmd+S will use PUT
    fsProvider.setReadonlyContent(uri, yamlContent);
    const doc = await vscode.workspace.openTextDocument(uri);
    if (doc.languageId !== 'yaml') {
      await vscode.languages.setTextDocumentLanguage(doc, 'yaml');
    }
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    // Mark as dirty by replacing content via edit
    const fullRange = new vscode.Range(
      new vscode.Position(0, 0),
      doc.lineAt(doc.lineCount - 1).range.end,
    );
    await editor.edit((eb) => {
      eb.replace(fullRange, yamlContent);
    });
  } else {
    // Create a new scaffold
    const scaffold = stringify({
      apiVersion: 'openchoreo.dev/v1alpha1',
      kind: 'ReleaseBinding',
      metadata: {
        name: `${component}-${environment}`,
        namespace: ns,
      },
      spec: {
        owner: {
          projectName: project,
          componentName: component,
        },
        environment,
        releaseName,
      },
    }, { lineWidth: 0 });
    openScaffold('ReleaseBinding', fsProvider, ns, project, scaffold);
  }
}

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
import { CRD_KIND_TO_SCAFFOLD } from '../services/yamlService';
import { buildPutRequest } from '../services/apiRoutes';
import {
  buildResourceUri,
  FS_SCHEME,
  type OpenChoreoFileSystemProvider,
} from '../filesystem/fileSystemProvider';

export function registerCommands(
  context: vscode.ExtensionContext,
  authProvider: OccConfigAuthProvider,
  resourceExplorer: ResourceExplorerProvider,
  infrastructureExplorer: InfrastructureExplorerProvider,
  apiClientManager: ApiClientManager,
  deleteService: DeleteService,
  capabilityService: CapabilityService,
  fsProvider: OpenChoreoFileSystemProvider,
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

  // Open resource via the virtual filesystem
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.openResource',
      async (node: ResourceNodeData) => {
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

  // Create new resource from scaffold (opens as untitled document)
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

        const ctxInfo = authProvider.getContextInfo();
        openScaffold(selected, fsProvider, ctxInfo?.namespace, ctxInfo?.project);
      },
    ),
  );

  // Create child resource from tree item context (inline "+" button)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'openchoreo.createChildResource',
      async (node: ResourceNodeData) => {
        if (!node) {
          return;
        }

        const ctxInfo = authProvider.getContextInfo();
        const ns = node.namespace ?? ctxInfo?.namespace;

        if (node.type === 'project') {
          // Project node → ask: Component or DeploymentPipeline?
          const choice = await vscode.window.showQuickPick(
            ['Component', 'DeploymentPipeline'],
            { placeHolder: `Create resource in project '${node.project}'` },
          );
          if (!choice) {
            return;
          }
          openScaffold(choice, fsProvider, ns, node.project);
          return;
        }

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
            // Cluster-scoped
            'cluster-component-types': 'ComponentType',
            'cluster-workflows': 'Workflow',
            'cluster-traits': 'Trait',
            'cluster-data-planes': 'DataPlane',
            'cluster-workflow-planes': 'WorkflowPlane',
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

  const ns = namespace ?? 'default';
  scaffold = scaffold.replace(/\{\{namespace\}\}/g, ns);
  scaffold = scaffold.replace(/\{\{project\}\}/g, project ?? 'default');

  // Build a URI for the new resource on the virtual filesystem
  const placeholderName = `new-${kind.toLowerCase()}`;
  const nodeType = kindToNodeType(kind);
  const uri = vscode.Uri.from({
    scheme: FS_SCHEME,
    path: `/${ns}/${nodeType}/${placeholderName}.yaml`,
  });

  // Store scaffold content so readFile returns it instead of fetching from API
  provider.setPendingContent(uri, scaffold);

  const doc = await vscode.workspace.openTextDocument(uri);
  if (doc.languageId !== 'yaml') {
    await vscode.languages.setTextDocumentLanguage(doc, 'yaml');
  }
  const editor = await vscode.window.showTextDocument(doc);

  // Mark document as dirty so the user knows it needs saving
  const pos = new vscode.Position(0, 0);
  await editor.edit((eb) => eb.insert(pos, ' '));
  await vscode.commands.executeCommand('undo');
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
  };
  return map[kind] ?? kind.toLowerCase();
}

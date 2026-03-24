// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as path from 'path';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';
import { OccConfigAuthProvider } from './auth/authProvider';
import { ApiClientManager } from './api/apiClient';
import { ResourceExplorerProvider } from './treeView/resourceExplorer';
import { InfrastructureExplorerProvider } from './treeView/infrastructureExplorer';
import { StatusBarManager } from './statusBar/statusBar';
import { CapabilityService } from './services/capabilityService';
import { DeleteService } from './services/deleteService';
import { registerCommands } from './commands/commands';
import { registerNamespaceSelector } from './commands/namespaceSelector';
import { initLogger, log } from './logging/logger';
import { ClusterExplorerProvider } from './treeView/clusterExplorer';
import {
  OpenChoreoFileSystemProvider,
  FS_SCHEME,
} from './filesystem/fileSystemProvider';

let client: LanguageClient;

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  // Initialize output channel logger
  initLogger();

  // Initialize authentication provider (reads occ CLI session)
  const authProvider = new OccConfigAuthProvider(context);
  context.subscriptions.push(authProvider);

  // Initialize typed API client manager
  const apiClientManager = new ApiClientManager(authProvider);

  // Initialize status bar
  const statusBar = new StatusBarManager(authProvider);
  context.subscriptions.push(statusBar);

  // Initialize RBAC capability service
  const capabilityService = new CapabilityService(authProvider, apiClientManager);

  // Initialize delete service
  const deleteService = new DeleteService(apiClientManager);

  // Initialize resource explorer tree view
  const resourceExplorer = new ResourceExplorerProvider(
    authProvider,
    apiClientManager,
    capabilityService,
  );
  const resourceTreeView = vscode.window.createTreeView(
    'openchoreo.resourceExplorer',
    {
      treeDataProvider: resourceExplorer,
      showCollapseAll: true,
    },
  );
  context.subscriptions.push(resourceTreeView);

  // Initialize infrastructure explorer tree view
  const infrastructureExplorer = new InfrastructureExplorerProvider(
    authProvider,
    apiClientManager,
    capabilityService,
  );
  const infrastructureTreeView = vscode.window.createTreeView(
    'openchoreo.infrastructureExplorer',
    {
      treeDataProvider: infrastructureExplorer,
      showCollapseAll: true,
    },
  );
  context.subscriptions.push(infrastructureTreeView);

  // Show current namespace in view descriptions
  const updateViewDescriptions = () => {
    const ns = authProvider.getContextInfo()?.namespace;
    resourceTreeView.description = ns || undefined;
    infrastructureTreeView.description = ns || undefined;
  };
  updateViewDescriptions();
  context.subscriptions.push(
    authProvider.onDidChangeSession(updateViewDescriptions),
  );

  // Initialize cluster resources explorer tree view
  const clusterExplorer = new ClusterExplorerProvider(
    authProvider,
    apiClientManager,
    capabilityService,
  );
  const clusterTreeView = vscode.window.createTreeView(
    'openchoreo.clusterExplorer',
    {
      treeDataProvider: clusterExplorer,
      showCollapseAll: true,
    },
  );
  context.subscriptions.push(clusterTreeView);

  // Register cluster refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('openchoreo.refreshCluster', () => {
      clusterExplorer.refresh();
    }),
  );

  // Register virtual filesystem provider for resource editing
  const fsProvider = new OpenChoreoFileSystemProvider(
    apiClientManager,
    () => {
      resourceExplorer.refresh();
      infrastructureExplorer.refresh();
      clusterExplorer.refresh();
    },
  );
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(FS_SCHEME, fsProvider, {
      isCaseSensitive: true,
      isReadonly: false,
    }),
  );

  // Register commands
  registerCommands(
    context,
    authProvider,
    resourceExplorer,
    infrastructureExplorer,
    apiClientManager,
    deleteService,
    capabilityService,
  );

  // Register namespace selector
  registerNamespaceSelector(context, authProvider, apiClientManager);

  // Start language server and push resource names for dynamic completions
  client = startLanguageServer(context);
  const pushNames = () => pushResourceNames(client, apiClientManager, authProvider);
  // Push resource names once the server is initialized
  setTimeout(pushNames, 2000);
  context.subscriptions.push(
    authProvider.onDidChangeSession(pushNames),
  );

  // Watch for occ config changes
  authProvider.startWatching();
}

export async function deactivate(): Promise<void> {
  if (client) {
    await client.stop();
  }
}

/**
 * Fetch resource names from the API and push them to the language server
 * for dynamic value completions (e.g., componentType → list of ComponentType names).
 */
async function pushResourceNames(
  langClient: LanguageClient,
  apiClientManager: ApiClientManager,
  authProvider: OccConfigAuthProvider,
): Promise<void> {
  try {
    const api = await apiClientManager.getClient();
    if (!api) {
      return;
    }

    const ns = authProvider.getContextInfo()?.namespace;
    if (!ns) {
      return;
    }

    const params = { params: { path: { namespaceName: ns } } };
    const names = (items: Array<{ metadata?: { name?: string } }>) =>
      items.map((i) => i.metadata?.name).filter((n): n is string => !!n);

    const resources: Record<string, string[]> = {};

    // Fetch all resource types in parallel, skip individual failures
    await Promise.allSettled([
      // Namespace-scoped resources
      api.GET('/api/v1/namespaces/{namespaceName}/projects', params).then(r => { resources['Project'] = names(r.data?.items ?? []); }),
      api.GET('/api/v1/namespaces/{namespaceName}/components', params).then(r => { resources['Component'] = names(r.data?.items ?? []); }),
      api.GET('/api/v1/namespaces/{namespaceName}/componenttypes', params).then(r => { resources['ComponentType'] = names(r.data?.items ?? []); }),
      api.GET('/api/v1/namespaces/{namespaceName}/workflows', params).then(r => { resources['Workflow'] = names(r.data?.items ?? []); }),
      api.GET('/api/v1/namespaces/{namespaceName}/traits', params).then(r => { resources['Trait'] = names(r.data?.items ?? []); }),
      api.GET('/api/v1/namespaces/{namespaceName}/environments', params).then(r => { resources['Environment'] = names(r.data?.items ?? []); }),
      api.GET('/api/v1/namespaces/{namespaceName}/dataplanes', params).then(r => { resources['DataPlane'] = names(r.data?.items ?? []); }),
      api.GET('/api/v1/namespaces/{namespaceName}/workflowplanes', params).then(r => { resources['WorkflowPlane'] = names(r.data?.items ?? []); }),
      api.GET('/api/v1/namespaces/{namespaceName}/deploymentpipelines', params).then(r => { resources['DeploymentPipeline'] = names(r.data?.items ?? []); }),
      // Cluster-scoped resources (no namespace param)
      api.GET('/api/v1/namespaces').then(r => { resources['Namespace'] = names(r.data?.items ?? []); }),
      api.GET('/api/v1/clustercomponenttypes').then(r => { resources['ClusterComponentType'] = names(r.data?.items ?? []); }),
      api.GET('/api/v1/clusterworkflows').then(r => { resources['ClusterWorkflow'] = names(r.data?.items ?? []); }),
      api.GET('/api/v1/clustertraits').then(r => { resources['ClusterTrait'] = names(r.data?.items ?? []); }),
    ]);

    log.debug(`Pushing resource names to language server: ${Object.entries(resources).map(([k, v]) => `${k}(${v.length})`).join(', ')}`);
    langClient.sendNotification('openchoreo/updateResources', resources);
  } catch {
    // Non-fatal — completions just won't have dynamic values
  }
}

function startLanguageServer(
  context: vscode.ExtensionContext,
): LanguageClient {
  const serverModule = context.asAbsolutePath(
    path.join('..', 'language-server', 'dist', 'server.js'),
  );

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  };

  // Resolve schemas path — check local copy first (VSIX), then monorepo root (F5 dev)
  const localSchemas = path.join(context.extensionPath, 'schemas');
  const repoSchemas = path.join(context.extensionPath, '..', '..', 'schemas');
  const fs = require('fs');
  const schemasPath = fs.existsSync(localSchemas) ? localSchemas : repoSchemas;

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'yaml' },
      { scheme: 'untitled', language: 'yaml' },
      { scheme: FS_SCHEME },
    ],
    initializationOptions: {
      schemasPath,
    },
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.yaml'),
    },
  };

  const client = new LanguageClient(
    'openchoreoLanguageServer',
    'OpenChoreo Language Server',
    serverOptions,
    clientOptions,
  );

  client.start();
  return client;
}

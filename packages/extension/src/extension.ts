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
import { SidebarViewProvider } from './webview/sidebarViewProvider';
import { registerMcpServers } from './mcp/mcpProvider';
import { setExtensionUri } from './treeView/shared';
import { ComponentService } from './services/componentService';
import { WorkflowRunService } from './services/workflowRunService';
import { ReleaseBindingService } from './services/releaseBindingService';
import { LogOutputService } from './services/logOutputService';
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

  // Set extension URI for custom icon resolution
  setExtensionUri(context.extensionUri);

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

  // Initialize new feature services
  const componentService = new ComponentService(apiClientManager);
  const workflowRunService = new WorkflowRunService(apiClientManager);
  const releaseBindingService = new ReleaseBindingService(apiClientManager);
  const logOutputService = new LogOutputService();
  context.subscriptions.push(logOutputService);

  // Initialize data providers (used by the sidebar webview)
  const resourceExplorer = new ResourceExplorerProvider(
    authProvider,
    apiClientManager,
    capabilityService,
    workflowRunService,
    releaseBindingService,
  );
  const infrastructureExplorer = new InfrastructureExplorerProvider(
    authProvider,
    apiClientManager,
    capabilityService,
  );
  const clusterExplorer = new ClusterExplorerProvider(
    authProvider,
    apiClientManager,
    capabilityService,
  );

  // Initialize sidebar webview
  const sidebarProvider = new SidebarViewProvider(
    context.extensionUri,
    authProvider,
    resourceExplorer,
    infrastructureExplorer,
    clusterExplorer,
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarViewProvider.viewType,
      sidebarProvider,
    ),
  );

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
      sidebarProvider.refreshAll();
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
    fsProvider,
    componentService,
    workflowRunService,
    releaseBindingService,
    logOutputService,
    sidebarProvider,
  );

  // Register namespace selector
  registerNamespaceSelector(context, authProvider, apiClientManager);

  // Start language server and push resource names for dynamic completions
  client = startLanguageServer(context);
  const pushAll = async () => {
    try {
      await pushResourceNames(client, apiClientManager, authProvider);
      await pushResourceSchemas(client, apiClientManager, authProvider);
    } catch (err) {
      log.error('Failed to push resource data to language server', err);
    }
  };
  // Push resource data once the server is initialized
  setTimeout(pushAll, 2000);
  context.subscriptions.push(
    authProvider.onDidChangeSession(pushAll),
  );

  // Register OpenChoreo MCP servers for Copilot Chat
  registerMcpServers(context, authProvider);

  // Periodic token pre-refresh — ensures tokens stay fresh for MCP and API calls.
  // getToken() checks expiry and refreshes if needed, writing back to occ config.
  // The config file watcher detects the change and fires onDidChangeSession,
  // which re-registers MCP with the fresh token.
  const tokenRefreshInterval = setInterval(async () => {
    try {
      await authProvider.getToken();
    } catch {
      // Non-fatal
    }
  }, 4 * 60 * 1000); // Every 4 minutes (tokens expire with 60s buffer)
  context.subscriptions.push({ dispose: () => clearInterval(tokenRefreshInterval) });

  // Auto-refresh resource trees (useful for live workflow run status updates)
  const config = vscode.workspace.getConfiguration('openchoreo');
  if (config.get<boolean>('autoRefresh', false)) {
    const interval = (config.get<number>('autoRefreshInterval', 30)) * 1000;
    const autoRefreshTimer = setInterval(() => {
      resourceExplorer.refresh();
    }, interval);
    context.subscriptions.push({ dispose: () => clearInterval(autoRefreshTimer) });
  }

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
      api.GET('/api/v1/namespaces/{namespaceName}/componentreleases', params).then(r => {
        // Group releases by component for scoped completions
        for (const item of r.data?.items ?? []) {
          const relName = item.metadata?.name as string;
          const compName = (item as { spec?: { owner?: { componentName?: string } } })?.spec?.owner?.componentName;
          if (relName && compName) {
            const key = `ComponentRelease:${compName}`;
            (resources[key] ??= []).push(relName);
          }
        }
      }),
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

/**
 * Fetch openAPIV3Schema content for ComponentTypes and Traits,
 * and push to the language server for cross-document completions.
 */
async function pushResourceSchemas(
  langClient: LanguageClient,
  apiClientManager: ApiClientManager,
  authProvider: OccConfigAuthProvider,
): Promise<void> {
  try {
    const api = await apiClientManager.getClient();
    if (!api) {
      log.debug('pushResourceSchemas: no API client');
      return;
    }

    const ns = authProvider.getContextInfo()?.namespace;
    log.debug(`pushResourceSchemas: namespace=${ns ?? 'none'}`);

    // Schema data: { kind: { resourceName: { parameters?: object, environmentConfigs?: object } } }
    const schemas: Record<string, Record<string, { parameters?: unknown; environmentConfigs?: unknown }>> = {};

    const extractSchema = (item: unknown): { parameters?: unknown; environmentConfigs?: unknown } | undefined => {
      const spec = (item as { spec?: { parameters?: { openAPIV3Schema?: unknown }; environmentConfigs?: { openAPIV3Schema?: unknown } } })?.spec;
      if (!spec) return undefined;
      return {
        parameters: spec.parameters?.openAPIV3Schema,
        environmentConfigs: spec.environmentConfigs?.openAPIV3Schema,
      };
    };

    const fetchers: Array<Promise<void>> = [];

    // Fetch cluster-scoped ComponentTypes (always available)
    fetchers.push(
      api.GET('/api/v1/clustercomponenttypes').then(r => {
        schemas['ClusterComponentType'] = {};
        for (const item of r.data?.items ?? []) {
          const name = (item.metadata?.name as string);
          if (name) {
            const s = extractSchema(item);
            if (s) schemas['ClusterComponentType'][name] = s;
          }
        }
      }).catch(() => {}),
    );

    // Fetch cluster-scoped Traits
    fetchers.push(
      api.GET('/api/v1/clustertraits').then(r => {
        schemas['ClusterTrait'] = {};
        for (const item of r.data?.items ?? []) {
          const name = (item.metadata?.name as string);
          if (name) {
            const s = extractSchema(item);
            if (s) schemas['ClusterTrait'][name] = s;
          }
        }
      }).catch(() => {}),
    );

    // Fetch cluster-scoped Workflows
    fetchers.push(
      api.GET('/api/v1/clusterworkflows').then(r => {
        schemas['ClusterWorkflow'] = {};
        for (const item of r.data?.items ?? []) {
          const name = (item.metadata?.name as string);
          if (name) {
            const s = extractSchema(item);
            if (s) schemas['ClusterWorkflow'][name] = s;
          }
        }
      }).catch(() => {}),
    );

    // Namespace-scoped (if namespace selected)
    if (ns) {
      const params = { params: { path: { namespaceName: ns } } };

      fetchers.push(
        api.GET('/api/v1/namespaces/{namespaceName}/componenttypes', params).then(r => {
          schemas['ComponentType'] = {};
          for (const item of r.data?.items ?? []) {
            const name = (item.metadata?.name as string);
            if (name) {
              const s = extractSchema(item);
              if (s) schemas['ComponentType'][name] = s;
            }
          }
        }).catch(() => {}),
      );

      fetchers.push(
        api.GET('/api/v1/namespaces/{namespaceName}/traits', params).then(r => {
          schemas['Trait'] = {};
          for (const item of r.data?.items ?? []) {
            const name = (item.metadata?.name as string);
            if (name) {
              const s = extractSchema(item);
              if (s) schemas['Trait'][name] = s;
            }
          }
        }).catch(() => {}),
      );

      fetchers.push(
        api.GET('/api/v1/namespaces/{namespaceName}/workflows', params).then(r => {
          schemas['Workflow'] = {};
          for (const item of r.data?.items ?? []) {
            const name = (item.metadata?.name as string);
            if (name) {
              const s = extractSchema(item);
              if (s) schemas['Workflow'][name] = s;
            }
          }
        }).catch(() => {}),
      );
    }

    await Promise.allSettled(fetchers);

    const total = Object.values(schemas).reduce((sum, m) => sum + Object.keys(m).length, 0);
    const detail = Object.entries(schemas).map(([kind, m]) => {
      const names = Object.entries(m).map(([n, s]) => `${n}(p:${!!s.parameters},e:${!!s.environmentConfigs})`);
      return `${kind}:[${names.join(',')}]`;
    }).join(' ');
    log.debug(`Pushing resource schemas: ${total} total — ${detail}`);
    langClient.sendNotification('openchoreo/updateResourceSchemas', schemas);
  } catch {
    // Non-fatal
  }
}

function startLanguageServer(
  context: vscode.ExtensionContext,
): LanguageClient {
  // Check bundled copy first (VSIX), then monorepo sibling (F5 dev)
  const bundledServer = path.join(context.extensionPath, 'language-server', 'dist', 'server.js');
  const repoServer = path.join(context.extensionPath, '..', 'language-server', 'dist', 'server.js');
  const nodeFs = require('fs');
  const serverModule = nodeFs.existsSync(bundledServer) ? bundledServer : repoServer;

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

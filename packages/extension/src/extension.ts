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
import {
  OpenChoreoFileSystemProvider,
  FS_SCHEME,
} from './filesystem/fileSystemProvider';

let client: LanguageClient;

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
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

  // Register virtual filesystem provider for resource editing
  const fsProvider = new OpenChoreoFileSystemProvider(
    apiClientManager,
    () => {
      resourceExplorer.refresh();
      infrastructureExplorer.refresh();
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

  // Start language server
  client = startLanguageServer(context);

  // Watch for occ config changes
  authProvider.startWatching();
}

export async function deactivate(): Promise<void> {
  if (client) {
    await client.stop();
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

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'yaml' },
      { scheme: 'untitled', language: 'yaml' },
      { scheme: FS_SCHEME, language: 'yaml' },
    ],
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

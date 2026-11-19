// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { spawn, type ChildProcess } from 'child_process';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  CloseAction,
  ErrorAction,
} from 'vscode-languageclient/node';
import { OccConfigAuthProvider } from './auth/authProvider';
import { OccCliDetector } from './auth/occCliDetector';
import { LoginRunner } from './auth/loginRunner';
import { ApiClientManager } from './api/apiClient';
import { ResourceExplorerProvider } from './treeView/resourceExplorer';
import { InfrastructureExplorerProvider } from './treeView/infrastructureExplorer';
import { StatusBarManager } from './statusBar/statusBar';
import { CapabilityService } from './services/capabilityService';
import { DeleteService } from './services/deleteService';
import { registerCommands, resolveNode } from './commands/commands';
import { registerDevLoopCommands } from './commands/devLoopCommands';
import { registerDebugAgainstEnv } from './devloop/debugAgainstEnv';
import { registerNamespaceSelector } from './commands/namespaceSelector';
import { initLogger, log } from './logging/logger';
import { ClusterExplorerProvider } from './treeView/clusterExplorer';
import { SidebarViewProvider } from './webview/sidebarViewProvider';
import { registerMcpServers } from './mcp/mcpProvider';
import { getOccBinaryPath } from './cli/cliPath';
import { registerTerminalPath } from './cli/terminalPath';
import { registerLanguageModelTools } from './ai/tools';
import { registerChatHandoffs } from './ai/chatHandoffs';
import { registerOtherAgentsGuide } from './ai/otherAgents';
import { setExtensionUri } from './treeView/shared';
import { registerGitOps } from './gitops';
import { ComponentSourceService } from './workspace/componentSources';
import { ComponentLinkService } from './workspace/componentLinks';
import { registerLinkedComponentCommands } from './workspace/linkedComponentCommands';
import { BuildFollower } from './workspace/builds';
import { registerCloneSource } from './workspace/cloneSource';
import { ComponentService } from './services/componentService';
import { WorkflowRunService } from './services/workflowRunService';
import { ReleaseBindingService } from './services/releaseBindingService';
import { LogOutputService } from './services/logOutputService';
import { ServerInfoService } from './services/serverInfoService';
import { getResourceContextId, resourceContextId, setResourceContextId } from './services/resourceContext';
import { DefinitionUnderlines } from './services/definitionUnderlines';
import { LanguageServerValidation } from './services/languageServerValidation';
import { pushResourceNames, pushResourceSchemas } from './services/languageServerFeed';
import {
  OpenChoreoFileSystemProvider,
  FS_SCHEME,
} from './filesystem/fileSystemProvider';

import { checkOccLsp, OccLanguageServer, terminateServerProcess, type ManagedLanguageClient } from './services/occLanguageServer';

let languageServer: OccLanguageServer | undefined;

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
  setResourceContextId(resourceContextId(authProvider.getContextInfo()));

  // All spawn-occ call sites resolve the binary through this thunk so a
  // download completing mid-session takes effect on the next invocation.
  const resolveOccBinary = (): string => getOccBinaryPath(context);

  // Detect whether the occ CLI is installed (drives the "no-cli" sidebar state)
  const occCliDetector = new OccCliDetector(resolveOccBinary);

  // Programmatic `occ login` runner — replaces the old terminal-based login
  const loginRunner = new LoginRunner(resolveOccBinary);
  context.subscriptions.push(loginRunner);

  // Initialize typed API client manager
  const apiClientManager = new ApiClientManager(authProvider);

  // Track the connected control plane's version for version-gated features
  const serverInfo = new ServerInfoService(authProvider, apiClientManager);
  context.subscriptions.push(serverInfo);

  // Initialize status bar
  const statusBar = new StatusBarManager(authProvider, occCliDetector, loginRunner, serverInfo);
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
    occCliDetector,
    loginRunner,
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

  // GitOps: index the workspace's GitOps repository, compare it with the
  // cluster, and guard API writes to resources a GitOps tool manages
  const repoIndex = registerGitOps(context, {
    authProvider,
    apiClientManager,
    fsProvider,
    resolveNode: (arg) => resolveNode(arg, sidebarProvider),
    resolveBinary: resolveOccBinary,
    onModeChange: () => sidebarProvider.refreshAll(),
  });

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
    loginRunner,
    resolveOccBinary,
    occCliDetector,
    serverInfo,
    sidebarProvider,
    repoIndex,
  );

  // Link workspace folders to the components built from them
  const componentSources = new ComponentSourceService(authProvider, apiClientManager);
  const componentLinks = new ComponentLinkService(authProvider, componentSources);
  context.subscriptions.push(componentLinks);
  const buildFollower = new BuildFollower(componentLinks, apiClientManager, workflowRunService);
  context.subscriptions.push(buildFollower);
  registerLinkedComponentCommands(context, componentLinks, buildFollower);
  registerCloneSource(context, {
    sources: componentSources,
    links: componentLinks,
    resolveNode: (arg) => resolveNode(arg, sidebarProvider),
  });
  void componentLinks.start();

  const devLoopDeps = {
    authProvider,
    apiClientManager,
    serverInfo,
    logOutputService,
    resolveBinary: resolveOccBinary,
    resolveNode: (arg: unknown) => resolveNode(arg, sidebarProvider),
  };
  registerDevLoopCommands(context, devLoopDeps);
  registerDebugAgainstEnv(context, devLoopDeps);

  // Register namespace selector
  registerNamespaceSelector(context, authProvider, apiClientManager);

  const definitionUnderlines = new DefinitionUnderlines((uri, position) => languageServer?.hasDefinition(uri, position) ?? Promise.resolve(false));
  context.subscriptions.push(definitionUnderlines);
  languageServer = new OccLanguageServer({
    changed: () => definitionUnderlines.refresh(),
    resolveBinary: resolveOccBinary,
    checkBinary: checkOccLsp,
    createClient: (binary, closed) => createLanguageClient(binary, closed, () => definitionUnderlines.refresh()),
    navigationContext: () => ({contextId: getResourceContextId() || null, namespace: authProvider.getContextInfo()?.namespace ?? null}),
    refresh: async (client, current, generation) => {
      const navigation = {contextId: getResourceContextId() || null, namespace: authProvider.getContextInfo()?.namespace ?? null, generation};
      await Promise.all([
        pushResourceNames(client, apiClientManager, authProvider, current, navigation, (ns) => repoIndex.namesByKind(ns)),
        pushResourceSchemas(client, apiClientManager, authProvider, current),
      ]);
    },
    report: (message) => { void vscode.window.showErrorMessage(message); },
  });
  let repoPushTimer: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    repoIndex.onDidChange(() => {
      if (repoPushTimer) clearTimeout(repoPushTimer);
      repoPushTimer = setTimeout(() => void languageServer?.refresh(), 2000);
    }),
    { dispose: () => { if (repoPushTimer) clearTimeout(repoPushTimer); } },
    vscode.commands.registerCommand('openchoreo.restartLanguageServer', () => languageServer?.restart()),
    authProvider.onDidChangeSession(() => {
      setResourceContextId(resourceContextId(authProvider.getContextInfo()));
      if (authProvider.getSession()) {
        void languageServer?.refresh();
      } else {
        void languageServer?.stop().catch(() => log.debug('Could not stop the language server after logout.'));
      }
    }),
  );
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const refreshNavigation = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { void languageServer?.refresh(); }, 75);
  };
  context.subscriptions.push(
    resourceExplorer.onDidChangeTreeData(refreshNavigation),
    infrastructureExplorer.onDidChangeTreeData(refreshNavigation),
    clusterExplorer.onDidChangeTreeData(refreshNavigation),
    { dispose: () => { if (refreshTimer) clearTimeout(refreshTimer); } },
  );
  // Startup failures must not interrupt the explorer or authentication UI.
  void languageServer.start();

  // Resolve the security-enabled flag for the current control plane before
  // MCP registration so the first provideMcpServerDefinitions() call has a
  // populated cache (otherwise auth-disabled clusters can race and produce
  // an empty initial server list that some MCP hosts then never refresh).
  await authProvider.prewarm();
  void serverInfo.refresh();

  // Register OpenChoreo MCP servers for Copilot Chat
  registerMcpServers(context, authProvider, apiClientManager);

  // Let agents and skills run the extension-managed occ from integrated terminals
  registerTerminalPath(context);

  // Chat tools for what only the editor knows (validation, session, scaffolds)
  registerLanguageModelTools(context, {
    validate: (text) => languageServer ? languageServer.validate(text) : Promise.reject(new Error('Language server is not running.')),
    authProvider, serverInfo,
  });

  // Troubleshoot and fix-it hand-offs from the tree and the editor to chat
  registerChatHandoffs(context, (arg) => resolveNode(arg, sidebarProvider));
  registerOtherAgentsGuide(context);

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

  // First-run nudge to download the occ CLI if it isn't present anywhere on
  // PATH. One-shot per profile (the NotConnectedView keeps a persistent
  // "Download for me" button so a dismissed prompt isn't a dead end).
  const CLI_PROMPT_KEY = 'cliDownloadPromptShown';
  void (async () => {
    if (context.globalState.get<boolean>(CLI_PROMPT_KEY)) return;
    const info = await occCliDetector.get();
    if (info.installed) return;
    await context.globalState.update(CLI_PROMPT_KEY, true);

    const DOWNLOAD = 'Download (~14 MB)';
    const MANUAL = 'Install Manually';
    const choice = await vscode.window.showInformationMessage(
      'OpenChoreo CLI (occ) is not installed. Download it now to log in to your cluster?',
      DOWNLOAD,
      MANUAL,
    );
    if (choice === DOWNLOAD) {
      void vscode.commands.executeCommand('openchoreo.downloadCli');
    } else if (choice === MANUAL) {
      void vscode.env.openExternal(
        vscode.Uri.parse('https://openchoreo.dev/docs/developer-guide/cli-installation/'),
      );
    }
  })();

  // Watch for occ config changes
  authProvider.startWatching();
}

export async function deactivate(): Promise<void> {
  await languageServer?.dispose();
  languageServer = undefined;
}

function createLanguageClient(binary: string, onClosed: () => void, onDiagnostics: () => void): ManagedLanguageClient {
  let process: ChildProcess | undefined;
  const definitionDebug = vscode.workspace.getConfiguration('openchoreo').get<boolean>('definitionDebug', false);
  if (definitionDebug) log.debug(`LSP executable: ${binary}`);
  // The Language Client invokes this factory. Keep the child handle so failed
  // protocol shutdown cannot leave a server behind during restart.
  const serverOptions: ServerOptions = async () => {
    process = spawn(binary, ['lsp', '--stdio', ...(definitionDebug ? ['--log-level', 'debug'] : [])], { stdio: 'pipe', windowsHide: true });
    return process;
  };
  const validation = new LanguageServerValidation((method, params) => client.isRunning() ? client.sendNotification(method, params) : Promise.reject(new Error('Language server stopped.')));
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.yaml');
  const clientOptions: LanguageClientOptions = {
    initializationOptions: { clusterReferenceFeeds: true },
    documentSelector: [
      { scheme: 'file', language: 'yaml' },
      { scheme: 'untitled', language: 'yaml' },
      { scheme: FS_SCHEME },
    ],
    synchronize: { fileEvents: watcher },
    middleware: {
      provideDefinition: async (document, position, token, next) => {
        if (definitionDebug) log.debug(`definition request ${document.uri.toString()} scheme=${document.uri.scheme} position=${position.line}:${position.character}`);
        const result = await next(document, position, token);
        if (definitionDebug) log.debug(`definition result ${JSON.stringify(result)}`);
        return result;
      },
      handleDiagnostics: (uri, diagnostics, next) => {
        const consumed = validation.accept(uri.toString(), diagnostics.map(d => ({
          message: d.message, severity: d.severity + 1,
          range: { start: { line: d.range.start.line, character: d.range.start.character } },
        })));
        if (!consumed) { next(uri, diagnostics); onDiagnostics(); }
      },
    },
    errorHandler: {
      error: () => ({ action: ErrorAction.Shutdown }),
      closed: () => { validation.dispose(); onClosed(); return { action: CloseAction.DoNotRestart }; },
    },
  };
  const client = new LanguageClient('openchoreoLanguageServer', 'OpenChoreo Language Server', serverOptions, clientOptions);
  return {
    hasDefinition: async (uri, position) => {
      if (!client.isRunning()) return false;
      const result = await client.sendRequest<unknown>('textDocument/definition', { textDocument: { uri }, position });
      return Array.isArray(result) ? result.length > 0 : !!result && typeof result === 'object' && 'uri' in result;
    },
    validate: (text) => validation.validate(text),
    start: () => client.start(),
    stop: async () => {
      try { await client.stop(); }
      catch { log.debug('Graceful LSP shutdown failed; terminating its child process.'); }
      finally { await terminateServerProcess(process); }
    },
    dispose: async () => {
      try { await client.dispose(); }
      finally { validation.dispose(); watcher.dispose(); await terminateServerProcess(process); }
    },
    isRunning: () => client.isRunning(),
    sendNotification: (method, params) => client.sendNotification(method, params),
  };
}

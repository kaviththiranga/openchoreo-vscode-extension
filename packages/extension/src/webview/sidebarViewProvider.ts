// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import type { OccConfigAuthProvider } from '../auth/authProvider';
import type { OccCliDetector } from '../auth/occCliDetector';
import type { LoginRunner } from '../auth/loginRunner';
import type { ResourceExplorerProvider } from '../treeView/resourceExplorer';
import type { InfrastructureExplorerProvider } from '../treeView/infrastructureExplorer';
import type { ClusterExplorerProvider } from '../treeView/clusterExplorer';
import type {
  WebviewToExtMessage,
  ExtToWebviewMessage,
  TreeSection,
  AuthState,
  ConnectionStatus,
} from './protocol';
import type { ResourceNodeData } from '../treeView/types';

/**
 * Hosts allowed in `openExternal` messages from the webview.
 * Prevents the webview from asking us to open arbitrary URLs.
 */
const ALLOWED_EXTERNAL_HOSTS = new Set(['openchoreo.dev', 'github.com']);

/** Build a local ID segment for a node. */
function localNodeId(node: ResourceNodeData): string {
  const parts: string[] = [node.type];
  if (node.namespace) parts.push(node.namespace);
  if (node.project) parts.push(node.project);
  if (node.component) parts.push(node.component);
  if (node.resourceName) parts.push(node.resourceName);
  parts.push(node.label);
  return parts.join(':');
}

/** Build a globally unique path-based node ID matching the webview's buildNodeId. */
function webviewNodeId(node: ResourceNodeData, parentPath: string = ''): string {
  const local = localNodeId(node);
  return parentPath ? `${parentPath}/${local}` : local;
}

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'openchoreo.sidebar';

  private view?: vscode.WebviewView;
  private disposables: vscode.Disposable[] = [];
  /** Cache of nodes by ID — used to resolve context menu command arguments. */
  private nodeCache = new Map<string, ResourceNodeData>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly authProvider: OccConfigAuthProvider,
    private readonly resourceExplorer: ResourceExplorerProvider,
    private readonly infrastructureExplorer: InfrastructureExplorerProvider,
    private readonly clusterExplorer: ClusterExplorerProvider,
    private readonly occCliDetector: OccCliDetector,
    private readonly loginRunner: LoginRunner,
  ) {
    // Re-send auth state + refresh when session changes
    this.disposables.push(
      authProvider.onDidChangeSession(() => {
        this.sendAuthState();
        this.postMessage({ type: 'refreshAll' });
      }),
    );
    // Re-send auth state when the login runner starts/stops/errors so the
    // sidebar can switch between no-session / logging-in / login-failed
    // without the 5s config-file-watcher lag. On exit (runner no longer
    // running), force an immediate config reload so a successful login
    // flips to the tree view within one tick instead of waiting up to 5s
    // for the file watcher to notice.
    this.disposables.push(
      loginRunner.onStateChange(() => {
        if (!loginRunner.isRunning()) {
          authProvider.reload();
        } else {
          this.sendAuthState();
        }
      }),
    );
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.extensionUri,
        // Allow access to sibling webview-ui package in dev (F5)
        vscode.Uri.joinPath(this.extensionUri, '..', 'webview-ui', 'dist'),
      ],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(
      (msg: WebviewToExtMessage) => this.handleMessage(msg),
      undefined,
      this.disposables,
    );

    // Clean up on dispose
    webviewView.onDidDispose(() => {
      this.view = undefined;
    });
  }

  /** Trigger a full refresh of the webview. */
  refreshAll(): void {
    this.postMessage({ type: 'refreshAll' });
  }

  /** Trigger a section-level refresh. */
  refreshSection(section: TreeSection): void {
    this.postMessage({ type: 'refreshSection', section });
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  // ── Message handling ──────────────────────────────────────────────

  private async handleMessage(msg: WebviewToExtMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.sendAuthState();
        this.sendIconsBaseUri();
        break;

      case 'requestRoots':
        await this.sendRoots(msg.section);
        break;

      case 'requestChildren':
        await this.sendChildren(msg.section, msg.nodeId, msg.lazyChildrenKey);
        break;

      case 'nodeClicked':
        this.handleNodeClick(msg.node);
        break;

      case 'executeCommand':
        vscode.commands.executeCommand(msg.command, ...(msg.args ?? []));
        break;

      case 'refresh':
        if (msg.section) {
          this.refreshProviderAndSend(msg.section);
        } else {
          this.refreshAll();
        }
        break;

      case 'selectNamespace':
        vscode.commands.executeCommand('openchoreo.selectNamespace');
        break;

      case 'startLogin':
        this.loginRunner.start();
        break;

      case 'cancelLogin':
        this.loginRunner.cancel();
        break;

      case 'recheckCli':
        await this.occCliDetector.recheck();
        this.sendAuthState();
        break;

      case 'downloadCli':
        // Delegate to the command — it handles progress, toasts, recheck.
        void vscode.commands.executeCommand('openchoreo.downloadCli');
        break;

      case 'openExternal': {
        try {
          const url = new URL(msg.url);
          if (!ALLOWED_EXTERNAL_HOSTS.has(url.hostname)) {
            return;
          }
          vscode.env.openExternal(vscode.Uri.parse(msg.url));
        } catch {
          // Malformed URL — ignore.
        }
        break;
      }
    }
  }

  private sendIconsBaseUri(): void {
    if (!this.view) return;
    const iconsUri = this.view.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'resources', 'icons'),
    );
    const fontUri = this.view.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'resources', 'openchoreo-icons.woff2'),
    );
    this.postMessage({ type: 'setIconsBaseUri', uri: iconsUri.toString(), fontUri: fontUri.toString() });
  }

  private async sendAuthState(): Promise<void> {
    const contextInfo = this.authProvider.getContextInfo();
    const session = this.authProvider.getSession();
    const cliInfo = await this.occCliDetector.get();

    let status: ConnectionStatus;
    let loginError: string | undefined;

    if (!cliInfo.installed) {
      status = 'no-cli';
    } else if (this.loginRunner.isRunning()) {
      status = 'logging-in';
    } else if ((loginError = this.loginRunner.consumeLastError())) {
      status = 'login-failed';
    } else if (!session) {
      status = 'no-session';
    } else {
      status = 'connected';
    }

    const state: AuthState = {
      connected: !!session,
      status,
      namespace: contextInfo?.namespace,
      contextName: contextInfo?.contextName,
      userDisplayName: this.authProvider.getUserIdentity()?.displayName,
      cliVersion: cliInfo.version,
      cliVersionDetails: cliInfo.versionDetails,
      loginError,
      securityDisabled: session ? !session.securityEnabled : undefined,
    };
    this.postMessage({ type: 'setAuthState', state });
  }

  private async sendRoots(section: TreeSection): Promise<void> {
    const provider = this.getProvider(section);
    const nodes = await provider.getChildren(undefined);
    this.cacheNodes(nodes);
    this.postMessage({ type: 'setRoots', section, nodes });
  }

  private async sendChildren(
    section: TreeSection,
    nodeId: string,
    lazyChildrenKey: string,
  ): Promise<void> {
    const provider = this.getProvider(section);
    // Look up the parent node from the cache to get its context fields
    const cached = this.nodeCache.get(nodeId);
    const syntheticParent: ResourceNodeData = {
      label: cached?.label ?? '',
      type: cached?.type ?? 'empty',
      contextValue: cached?.contextValue ?? '',
      childrenMode: 'lazy',
      lazyChildrenKey,
      namespace: cached?.namespace,
      project: cached?.project,
      component: cached?.component,
      resourceName: cached?.resourceName,
      extra: cached?.extra,
    };
    const nodes = await provider.getChildren(syntheticParent);
    this.cacheNodes(nodes, nodeId);
    this.postMessage({ type: 'setChildren', section, nodeId, nodes });
  }

  private handleNodeClick(node: ResourceNodeData): void {
    if (node.type === 'no-connection') {
      vscode.commands.executeCommand('openchoreo.login');
    } else if (node.type === 'k8s-resource' || node.type === 'k8s-pod') {
      vscode.commands.executeCommand('openchoreo.openK8sDefinition', node);
    } else {
      vscode.commands.executeCommand('openchoreo.openResource', node);
    }
  }

  private async refreshProviderAndSend(section: TreeSection): Promise<void> {
    const provider = this.getProvider(section);
    provider.refresh();
    // Small delay to let the provider reset, then fetch new roots
    setTimeout(() => this.sendRoots(section), 100);
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private getProvider(section: TreeSection) {
    switch (section) {
      case 'projects': return this.resourceExplorer;
      case 'infrastructure': return this.infrastructureExplorer;
      case 'cluster': return this.clusterExplorer;
    }
  }

  /** Cache nodes by path-based ID so context menu commands can look up full node data. */
  private cacheNodes(nodes: ResourceNodeData[], parentPath: string = ''): void {
    for (const node of nodes) {
      const id = webviewNodeId(node, parentPath);
      this.nodeCache.set(id, node);
      if (node.children) {
        this.cacheNodes(node.children, id);
      }
    }
  }

  /** Look up a cached node by its ID. Used by context menu command handlers. */
  getNode(nodeId: string): ResourceNodeData | undefined {
    return this.nodeCache.get(nodeId);
  }

  private postMessage(msg: ExtToWebviewMessage): void {
    this.view?.webview.postMessage(msg);
  }

  private getHtml(webview: vscode.Webview): string {
    // Check bundled copy first (VSIX), then monorepo sibling (F5 dev)
    const fs = require('fs');
    const bundled = vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'dist', 'webview.js');
    const baseDir = fs.existsSync(bundled.fsPath)
      ? vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'dist')
      : vscode.Uri.joinPath(this.extensionUri, '..', 'webview-ui', 'dist');

    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(baseDir, 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(baseDir, 'webview.css'));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
      style-src ${webview.cspSource} 'unsafe-inline';
      font-src ${webview.cspSource} data:;
      img-src ${webview.cspSource};
      script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>OpenChoreo</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

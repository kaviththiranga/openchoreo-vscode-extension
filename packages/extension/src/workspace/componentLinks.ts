// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Links workspace folders to the OpenChoreo components built from them, by
 * matching each folder's git remotes and path inside the repository against
 * the components' repository URL and app path (the same match auto-build
 * makes for a push).
 */
import * as path from 'path';
import * as vscode from 'vscode';
import type { OccConfigAuthProvider } from '../auth/authProvider';
import { getGitApi, type GitAPI, type GitRepository } from '../git/gitApi';
import { log } from '../logging/logger';
import type { ComponentSourceService, SourcedComponent } from './componentSources';
import { normalizeAppPath, normalizeRepoUrl } from './repositoryFields';

export interface FolderGitInfo {
  folder: vscode.Uri;
  /** The folder's path relative to its repository root ('' at the root). */
  pathInRepo: string;
  repoRoot: vscode.Uri;
  remoteUrls: string[];
}

export interface ComponentLink {
  component: SourcedComponent;
  folder: vscode.Uri;
  repoRoot: vscode.Uri;
  /** Absolute path of the component's app directory on disk. */
  appDir: string;
  /** exact: the folder is the app; contains: the app is inside the folder; inside: the folder is inside the app. */
  match: 'exact' | 'contains' | 'inside';
}

/** Match folders against components. Pure, so it can be unit tested. */
export function matchComponents(folders: FolderGitInfo[], components: SourcedComponent[]): ComponentLink[] {
  const links: ComponentLink[] = [];
  for (const info of folders) {
    const remotes = new Set(info.remoteUrls.map(normalizeRepoUrl).filter(Boolean));
    if (remotes.size === 0) continue;
    const folderPath = normalizeAppPath(info.pathInRepo);
    for (const component of components) {
      const repo = normalizeRepoUrl(component.url);
      if (!repo || !remotes.has(repo)) continue;
      const appPath = component.appPath ?? '';
      const match =
        appPath === folderPath
          ? 'exact'
          : folderPath === '' || appPath.startsWith(`${folderPath}/`)
            ? 'contains'
            : appPath === '' || folderPath.startsWith(`${appPath}/`)
              ? 'inside'
              : undefined;
      if (!match) continue;
      links.push({
        component,
        folder: info.folder,
        repoRoot: info.repoRoot,
        appDir: path.join(info.repoRoot.fsPath, ...appPath.split('/').filter(Boolean)),
        match,
      });
    }
  }
  const rank = { exact: 0, inside: 1, contains: 2 };
  return links.sort((a, b) => rank[a.match] - rank[b.match] || a.component.name.localeCompare(b.component.name));
}

/** The links for a file: components whose app directory contains it, deepest first. */
export function linksForPath(links: ComponentLink[], fsPath: string): ComponentLink[] {
  const within = (dir: string) => fsPath === dir || fsPath.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
  return links
    .filter((l) => within(l.appDir))
    .sort((a, b) => b.appDir.length - a.appDir.length);
}

export class ComponentLinkService implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly repoListeners = new Map<string, vscode.Disposable>();
  private readonly changed = new vscode.EventEmitter<ComponentLink[]>();
  readonly onDidChange = this.changed.event;
  private readonly pushed = new vscode.EventEmitter<PushEvent>();
  /** A branch of a workspace repository was pushed (its commits are now on the upstream). */
  readonly onDidPush = this.pushed.event;
  private git: GitAPI | undefined;
  private current: ComponentLink[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly authProvider: OccConfigAuthProvider,
    private readonly sources: ComponentSourceService,
  ) {
    this.item = vscode.window.createStatusBarItem('openchoreo.linkedComponent', vscode.StatusBarAlignment.Left, 99);
    this.item.name = 'OpenChoreo Linked Component';
    this.item.command = 'openchoreo.linkedComponentActions';
    this.disposables.push(
      this.item,
      this.changed,
      this.pushed,
      authProvider.onDidChangeSession(() => this.scheduleRefresh()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.scheduleRefresh()),
      vscode.window.onDidChangeActiveTextEditor(() => this.render()),
    );
  }

  async start(): Promise<void> {
    this.git = await getGitApi();
    if (this.git) {
      this.disposables.push(
        this.git.onDidOpenRepository((repo) => {
          this.watchRepository(repo);
          this.scheduleRefresh();
        }),
        this.git.onDidCloseRepository(() => this.scheduleRefresh()),
      );
      this.git.repositories.forEach((repo) => this.watchRepository(repo));
    }
    await this.refresh();
  }

  get links(): readonly ComponentLink[] {
    return this.current;
  }

  /** Links relevant to the active editor first, then the rest. */
  orderedLinks(): ComponentLink[] {
    const active = vscode.window.activeTextEditor?.document.uri;
    if (!active || active.scheme !== 'file') return [...this.current];
    const near = linksForPath(this.current, active.fsPath);
    return [...near, ...this.current.filter((l) => !near.includes(l))];
  }

  repositoryFor(link: ComponentLink): GitRepository | undefined {
    return this.git?.getRepository(link.repoRoot) ?? undefined;
  }

  scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), 500);
  }

  async refresh(): Promise<void> {
    try {
      const folders = this.folderInfo();
      if (folders.length === 0 || !this.authProvider.getSession()) {
        this.update([]);
        return;
      }
      this.update(matchComponents(folders, await this.sources.list()));
    } catch (err) {
      log.error('Linking workspace folders to components failed', err);
    }
  }

  private watchRepository(repo: GitRepository): void {
    const key = repo.rootUri.toString();
    if (this.repoListeners.has(key)) return;
    let remotes = remoteKey(repo);
    let head = headState(repo);
    const listener = repo.state.onDidChange(() => {
      const next = remoteKey(repo);
      if (next !== remotes) {
        remotes = next;
        this.scheduleRefresh();
      }
      const nextHead = headState(repo);
      if (isPush(head, nextHead)) {
        this.pushed.fire({ repository: repo, branch: nextHead.branch!, commit: nextHead.commit! });
      }
      head = nextHead;
    });
    this.repoListeners.set(key, listener);
  }

  private folderInfo(): FolderGitInfo[] {
    if (!this.git) return [];
    const infos: FolderGitInfo[] = [];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const repo = this.git.getRepository(folder.uri);
      if (!repo) continue;
      const remoteUrls = repo.state.remotes.flatMap((r) => [r.fetchUrl, r.pushUrl]).filter((u): u is string => !!u);
      infos.push({
        folder: folder.uri,
        repoRoot: repo.rootUri,
        pathInRepo: path.relative(repo.rootUri.fsPath, folder.uri.fsPath).split(path.sep).join('/'),
        remoteUrls,
      });
    }
    return infos;
  }

  private update(links: ComponentLink[]): void {
    const before = this.current.map(linkKey).join(',');
    this.current = links;
    void vscode.commands.executeCommand('setContext', 'openchoreo.linkedComponent', links.length > 0);
    this.render();
    if (links.map(linkKey).join(',') !== before) this.changed.fire(links);
  }

  private render(): void {
    const links = this.orderedLinks();
    if (links.length === 0) {
      this.item.hide();
      return;
    }
    const first = links[0].component;
    const others = new Set(links.map(linkKey)).size - 1;
    this.item.text = `$(link) ${first.name}${others > 0 ? ` +${others}` : ''}`;
    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown('**Linked OpenChoreo components**\n\n');
    for (const link of links) {
      const c = link.component;
      md.appendMarkdown(
        `- \`${c.name}\` in project \`${c.project}\` — ${c.branch ? `branch \`${c.branch}\`, ` : ''}` +
          `${c.appPath ? `\`${c.appPath}\`` : 'repository root'}\n`,
      );
    }
    md.appendMarkdown('\nClick for actions.');
    this.item.tooltip = md;
    this.item.show();
  }

  dispose(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.repoListeners.forEach((d) => d.dispose());
    this.disposables.forEach((d) => d.dispose());
  }
}

const linkKey = (l: ComponentLink) => `${l.component.namespace}/${l.component.name}`;
const remoteKey = (repo: GitRepository) =>
  repo.state.remotes.map((r) => `${r.name}=${r.fetchUrl ?? ''}`).sort().join(';');

export interface PushEvent {
  repository: GitRepository;
  branch: string;
  commit: string;
}

export interface HeadState {
  branch?: string;
  commit?: string;
  ahead?: number;
  hasUpstream: boolean;
}

const headState = (repo: GitRepository): HeadState => ({
  branch: repo.state.HEAD?.name,
  commit: repo.state.HEAD?.commit,
  ahead: repo.state.HEAD?.ahead,
  hasUpstream: !!repo.state.HEAD?.upstream,
});

/**
 * A push: same branch and commit, and the commits that were ahead of the
 * upstream no longer are (or the branch just got an upstream).
 */
export function isPush(before: HeadState, after: HeadState): boolean {
  if (!after.branch || !after.commit || before.branch !== after.branch || before.commit !== after.commit) return false;
  if (!after.hasUpstream || after.ahead !== 0) return false;
  return (before.ahead ?? 0) > 0 || !before.hasUpstream;
}

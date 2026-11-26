// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * The GitOps view: every OpenChoreo resource the repository declares, grouped
 * by namespace and kind, with whether the cluster matches it, plus resources
 * of the same kinds that exist only on the cluster.
 */
import * as vscode from 'vscode';
import { parseAllDocuments } from 'yaml';
import type { ApiClientManager } from '../api/apiClient';
import type { OccConfigAuthProvider } from '../auth/authProvider';
import { collectionPathParams, kindSpec } from '../kinds/registry';
import { log } from '../logging/logger';
import { fetchLive } from './compare';
import { isZero, toDesiredState } from './managed';
import type { GitOpsRepoIndex, RepoEntry } from './repoIndex';

export type SyncState = 'synced' | 'differs' | 'missing' | 'error' | 'unchecked';

/** Whether every field the repository sets has the same value on the cluster. */
export function isSubset(declared: unknown, live: unknown): boolean {
  // The API omits zero values (omitempty), so `isProduction: false` or `env: []` match a missing key.
  if ((live === undefined || live === null) && isZero(declared)) return true;
  if (Array.isArray(declared)) {
    return Array.isArray(live) && declared.length === live.length && declared.every((d, i) => isSubset(d, live[i]));
  }
  if (declared && typeof declared === 'object') {
    if (!live || typeof live !== 'object' || Array.isArray(live)) return false;
    return Object.entries(declared).every(([k, v]) => isSubset(v, (live as Record<string, unknown>)[k]));
  }
  if (declared === null || declared === undefined) return live === null || live === undefined;
  // YAML may say 8080 where the API returns "8080", or the other way round.
  return declared === live || String(declared) === String(live);
}

type Node =
  | { kind: 'namespace'; namespace: string }
  | { kind: 'group'; namespace: string; resourceKind: string }
  | { kind: 'entry'; entry: RepoEntry; state: SyncState; detail?: string }
  | { kind: 'clusterOnly'; namespace: string; resourceKind: string; name: string }
  | { kind: 'message'; text: string };

const CLUSTER = '(cluster-scoped)';
const STATE_ICON: Record<SyncState, [string, string | undefined, string]> = {
  synced: ['pass', 'testing.iconPassed', 'Matches the cluster'],
  differs: ['diff', 'list.warningForeground', 'Differs from the cluster'],
  missing: ['cloud-upload', 'list.warningForeground', 'Not on the cluster'],
  error: ['warning', 'list.errorForeground', 'Could not check'],
  unchecked: ['circle-outline', undefined, 'Not checked yet'],
};

export class GitOpsSyncView implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly states = new Map<string, { state: SyncState; detail?: string }>();
  private readonly clusterOnly = new Map<string, string[]>();
  private checking: Promise<void> | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly view: vscode.TreeView<Node>;

  constructor(
    private readonly repoIndex: GitOpsRepoIndex,
    private readonly apiClientManager: ApiClientManager,
    private readonly authProvider: OccConfigAuthProvider,
  ) {
    this.view = vscode.window.createTreeView('openchoreo.gitops', { treeDataProvider: this, showCollapseAll: true });
    this.disposables.push(
      this.view,
      this.changed,
      repoIndex.onDidChange(() => {
        // Edited files need checking again; the rest keep their state.
        const known = new Set(repoIndex.entries().map(entryKey));
        for (const key of this.states.keys()) if (!known.has(key)) this.states.delete(key);
        this.changed.fire(undefined);
        if (this.view.visible) void this.check(false);
      }),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        for (const e of repoIndex.entries()) if (e.uri.toString() === doc.uri.toString()) this.states.delete(entryKey(e));
      }),
      this.view.onDidChangeVisibility((e) => e.visible && void this.check(false)),
      authProvider.onDidChangeSession(() => {
        this.states.clear();
        this.clusterOnly.clear();
        this.changed.fire(undefined);
      }),
    );
  }

  /** Check entries against the cluster; `all` re-checks everything. */
  check(all: boolean): Promise<void> {
    if (this.checking) return this.checking;
    if (all) {
      this.states.clear();
      this.clusterOnly.clear();
    }
    this.checking = this.runCheck()
      .catch((err) => log.error('GitOps sync check failed', err))
      .finally(() => {
        this.checking = undefined;
        this.changed.fire(undefined);
      });
    return this.checking;
  }

  private async runCheck(): Promise<void> {
    if (!this.authProvider.getSession()) return;
    const pending = this.repoIndex.entries().filter((e) => !this.states.has(entryKey(e)) && kindSpec(e.kind)?.nodeType);
    const texts = new Map<string, string>();
    const docAt = async (e: RepoEntry) => {
      const k = e.uri.toString();
      if (!texts.has(k)) texts.set(k, new TextDecoder().decode(await vscode.workspace.fs.readFile(e.uri)));
      return parseAllDocuments(texts.get(k)!)[e.docIndex]?.toJS() as Record<string, unknown> | undefined;
    };
    await pool(pending, 6, async (e) => {
      try {
        const declared = await docAt(e);
        const live = await fetchLive(this.apiClientManager, { kind: e.kind, name: e.name, namespace: e.namespace });
        const state: SyncState = !live ? 'missing' : declared && isSubset(declared, toDesiredState(live)) ? 'synced' : 'differs';
        this.states.set(entryKey(e), { state });
      } catch (err) {
        this.states.set(entryKey(e), { state: 'error', detail: err instanceof Error ? err.message : String(err) });
      }
      this.changed.fire(undefined);
    });
    await this.findClusterOnly();
  }

  /** Resources of the kinds the repository declares that exist only on the cluster. */
  private async findClusterOnly(): Promise<void> {
    const client = await this.apiClientManager.getClient();
    if (!client) return;
    const declared = new Map<string, Set<string>>();
    for (const e of this.repoIndex.entries()) {
      const group = `${this.namespaceOf(e)}|${e.kind}`;
      if (!declared.has(group)) declared.set(group, new Set());
      declared.get(group)!.add(e.name);
    }
    // Releases and runs are generated history, not declared state.
    const skip = new Set(['ComponentRelease', 'ProjectRelease', 'ResourceRelease', 'WorkflowRun']);
    for (const [group, names] of declared) {
      const [namespace, kind] = group.split('|');
      const spec = kindSpec(kind);
      if (!spec || skip.has(kind) || this.clusterOnly.has(group)) continue;
      try {
        const { data, error } = (await client.GET(spec.collectionPath as never, {
          params: { path: collectionPathParams(spec, namespace === CLUSTER ? undefined : namespace) },
        } as never)) as { data?: { items?: Array<{ metadata?: { name?: string } }> }; error?: unknown };
        if (error) continue;
        this.clusterOnly.set(
          group,
          (data?.items ?? []).map((i) => i.metadata?.name ?? '').filter((n) => n && !names.has(n)),
        );
      } catch {
        // Listing is best effort.
      }
    }
  }

  private namespaceOf(e: RepoEntry): string {
    if (kindSpec(e.kind)?.scope === 'cluster') return CLUSTER;
    return e.namespace ?? this.authProvider.getContextInfo()?.namespace ?? 'default';
  }

  getChildren(node?: Node): Node[] {
    const entries = this.repoIndex.entries();
    if (!node) {
      if (entries.length === 0) return [{ kind: 'message', text: 'No OpenChoreo resources in this workspace.' }];
      const namespaces = [...new Set(entries.map((e) => this.namespaceOf(e)))].sort((a, b) =>
        a === CLUSTER ? -1 : b === CLUSTER ? 1 : a.localeCompare(b),
      );
      const header: Node[] = this.authProvider.getSession() ? [] : [{ kind: 'message', text: 'Log in to compare with the cluster.' }];
      return [...header, ...namespaces.map((namespace) => ({ kind: 'namespace' as const, namespace }))];
    }
    if (node.kind === 'namespace') {
      const kinds = new Set(entries.filter((e) => this.namespaceOf(e) === node.namespace).map((e) => e.kind));
      for (const group of this.clusterOnly.keys()) {
        const [ns, kind] = group.split('|');
        if (ns === node.namespace && this.clusterOnly.get(group)!.length) kinds.add(kind);
      }
      return [...kinds].sort().map((resourceKind) => ({ kind: 'group' as const, namespace: node.namespace, resourceKind }));
    }
    if (node.kind === 'group') {
      const declared: Node[] = entries
        .filter((e) => e.kind === node.resourceKind && this.namespaceOf(e) === node.namespace)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => ({ kind: 'entry' as const, entry, ...(this.states.get(entryKey(entry)) ?? { state: 'unchecked' as const }) }));
      const extra: Node[] = (this.clusterOnly.get(`${node.namespace}|${node.resourceKind}`) ?? []).map((name) => ({
        kind: 'clusterOnly' as const,
        namespace: node.namespace,
        resourceKind: node.resourceKind,
        name,
      }));
      return [...declared, ...extra];
    }
    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case 'message':
        return new vscode.TreeItem(node.text);
      case 'namespace': {
        const item = new vscode.TreeItem(node.namespace, vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon(node.namespace === CLUSTER ? 'globe' : 'folder-library');
        return item;
      }
      case 'group': {
        const item = new vscode.TreeItem(node.resourceKind, vscode.TreeItemCollapsibleState.Collapsed);
        const states = this.getChildren(node).map((n) => (n.kind === 'entry' ? n.state : n.kind === 'clusterOnly' ? 'differs' : 'synced'));
        const drift = states.filter((s) => s === 'differs' || s === 'missing').length;
        item.description = drift ? `${drift} out of sync` : undefined;
        item.iconPath = new vscode.ThemeIcon('symbol-class');
        return item;
      }
      case 'entry': {
        const item = new vscode.TreeItem(node.entry.name);
        const [icon, color, label] = STATE_ICON[node.state];
        item.iconPath = new vscode.ThemeIcon(icon, color ? new vscode.ThemeColor(color) : undefined);
        item.description = vscode.workspace.asRelativePath(node.entry.uri);
        item.tooltip = `${node.entry.kind} ${node.entry.name}: ${label}${node.detail ? `\n${node.detail}` : ''}`;
        item.contextValue = `gitopsEntry_${node.state}`;
        item.resourceUri = node.entry.uri;
        item.command = {
          title: 'Open',
          command: 'vscode.open',
          arguments: [node.entry.uri, { selection: new vscode.Range(node.entry.line, 0, node.entry.line, 0) }],
        };
        return item;
      }
      case 'clusterOnly': {
        const item = new vscode.TreeItem(node.name);
        item.iconPath = new vscode.ThemeIcon('cloud', new vscode.ThemeColor('list.warningForeground'));
        item.description = 'only on the cluster';
        item.tooltip = `${node.resourceKind} ${node.name} exists on the cluster but no file in the repository declares it.`;
        item.contextValue = 'gitopsClusterOnly';
        const spec = kindSpec(node.resourceKind);
        if (spec?.nodeType) {
          item.command = {
            title: 'Open',
            command: 'vscode.open',
            arguments: [
              vscode.Uri.from({
                scheme: 'openchoreo',
                path: spec.scope === 'cluster' ? `/${spec.nodeType}/${node.name}.yaml` : `/namespaces/${node.namespace}/${spec.nodeType}/${node.name}.yaml`,
                query: 'readonly',
              }),
            ],
          };
        }
        return item;
      }
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}

/** Arguments a view item passes to Compare with Cluster: the file and the document's line. */
export function entryOfNode(node: unknown): RepoEntry | undefined {
  return node && typeof node === 'object' && (node as Node).kind === 'entry' ? (node as { entry: RepoEntry }).entry : undefined;
}

const entryKey = (e: RepoEntry) => `${e.uri.toString()}#${e.docIndex}`;

async function pool<T>(items: T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await run(items[next++]);
    }),
  );
}

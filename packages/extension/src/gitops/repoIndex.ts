// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * An index of the OpenChoreo resources in the workspace's GitOps repository:
 * which file (and which document in it) declares each resource, so the tree,
 * Compare with Cluster and "Change in Repository" can find them.
 *
 * A workspace folder counts as a GitOps repository when it declares OpenChoreo
 * resources other than an app's own `workload.yaml` and `.openchoreo/` files.
 */
import * as path from 'path';
import * as vscode from 'vscode';
import { parseAllDocuments, stringify, type Document } from 'yaml';
import { kindSpec } from '../kinds/registry';
import { log } from '../logging/logger';
import { toDesiredState } from './managed';

export interface RepoEntry {
  kind: string;
  name: string;
  /** metadata.namespace, else the `namespaces/<ns>/` directory, else undefined. */
  namespace?: string;
  uri: vscode.Uri;
  /** Index of the document within a multi-document file. */
  docIndex: number;
  /** Zero-based line where the document starts. */
  line: number;
}

const MAX_FILES = 5000;
const EXCLUDE = '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**}';
const OPENCHOREO_API = /^apiVersion:\s*["']?openchoreo\.dev\//m;

/** Parse the OpenChoreo resources out of one file's text. Pure, for tests. */
export function entriesFromText(text: string, uri: vscode.Uri, relativePath: string): RepoEntry[] {
  if (!OPENCHOREO_API.test(text)) return [];
  const entries: RepoEntry[] = [];
  const dirNamespace = /(?:^|\/)namespaces\/([^/]+)\//.exec(relativePath)?.[1];
  const lineAt = lineIndex(text);
  parseAllDocuments(text).forEach((doc, docIndex) => {
    if (!('contents' in doc) || doc.errors.length > 0) return;
    const value = doc.toJS() as { apiVersion?: string; kind?: string; metadata?: { name?: string; namespace?: string } };
    if (!value?.apiVersion?.startsWith('openchoreo.dev/') || !value.kind || !value.metadata?.name) return;
    const clusterScoped = kindSpec(value.kind)?.scope === 'cluster';
    entries.push({
      kind: value.kind,
      name: value.metadata.name,
      namespace: clusterScoped ? undefined : value.metadata.namespace ?? dirNamespace,
      uri,
      docIndex,
      line: lineAt(doc.contents?.range?.[0] ?? 0),
    });
  });
  return entries;
}

/** Whether a file belongs to an app's own manifests rather than a GitOps repository. */
export function isAppManifest(relativePath: string): boolean {
  const parts = relativePath.split('/');
  return parts.includes('.openchoreo') || /^workload\.ya?ml$/.test(parts[parts.length - 1]);
}

function lineIndex(text: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
}

export class GitOpsRepoIndex implements vscode.Disposable {
  private readonly byFile = new Map<string, RepoEntry[]>();
  private readonly repoFolders = new Set<string>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private ready: Promise<void> = Promise.resolve();

  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{yaml,yml}');
    this.disposables.push(
      watcher,
      this.changed,
      watcher.onDidCreate((uri) => this.queue(uri)),
      watcher.onDidChange((uri) => this.queue(uri)),
      watcher.onDidDelete((uri) => this.queue(uri)),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.rebuild()),
    );
  }

  /** Scan the workspace. Resolves once the first index is built. */
  rebuild(): Promise<void> {
    this.ready = (async () => {
      this.byFile.clear();
      if (!vscode.workspace.workspaceFolders?.length) return this.publish();
      const files = await vscode.workspace.findFiles('**/*.{yaml,yml}', EXCLUDE, MAX_FILES);
      await Promise.all(files.map((uri) => this.indexFile(uri)));
      this.publish();
    })().catch((err) => log.error('Indexing the GitOps repository failed', err));
    return this.ready;
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  /** Whether any workspace folder is a GitOps repository. */
  get hasRepository(): boolean {
    return this.repoFolders.size > 0;
  }

  isInRepository(uri: vscode.Uri): boolean {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    return !!folder && this.repoFolders.has(folder.uri.toString());
  }

  /** Entries for a resource. Entries without a namespace match any namespace. */
  find(kind: string, name: string, namespace?: string): RepoEntry[] {
    const matches: RepoEntry[] = [];
    for (const entries of this.byFile.values()) {
      for (const e of entries) {
        if (e.kind !== kind || e.name !== name) continue;
        if (namespace && e.namespace && e.namespace !== namespace) continue;
        if (this.isInRepository(e.uri)) matches.push(e);
      }
    }
    return matches;
  }

  /** Workspace folders that are GitOps repositories. */
  repositoryFolders(): vscode.Uri[] {
    return [...this.repoFolders].map((u) => vscode.Uri.parse(u));
  }

  /** Resource names the repository declares, by kind, for a namespace (and cluster-scoped kinds). */
  namesByKind(namespace: string | undefined): Record<string, string[]> {
    const names: Record<string, string[]> = {};
    for (const e of this.entries()) {
      if (namespace && e.namespace && e.namespace !== namespace) continue;
      (names[e.kind] ??= []).includes(e.name) || names[e.kind].push(e.name);
    }
    return names;
  }

  entries(): RepoEntry[] {
    return [...this.byFile.values()].flat().filter((e) => this.isInRepository(e.uri));
  }

  /**
   * Write a resource into the repository as an unsaved edit for the user to
   * review: the changes between `before` and `after` onto the existing
   * document (keeping its comments and layout), or a new file when the
   * repository doesn't declare the resource yet.
   */
  async writeResource(after: Record<string, unknown>, before?: Record<string, unknown>): Promise<vscode.Uri | undefined> {
    await this.ready;
    const kind = String(after.kind ?? '');
    const meta = (after.metadata ?? {}) as { name?: string; namespace?: string };
    if (!kind || !meta.name) throw new Error('The resource has no kind or metadata.name.');
    const [entry] = this.find(kind, meta.name, meta.namespace);
    return entry ? this.updateEntry(entry, after, before) : this.createFile(after);
  }

  private async updateEntry(
    entry: RepoEntry,
    after: Record<string, unknown>,
    before: Record<string, unknown> | undefined,
  ): Promise<vscode.Uri> {
    const document = await vscode.workspace.openTextDocument(entry.uri);
    const text = document.getText();
    const doc = parseAllDocuments(text)[entry.docIndex] as Document | undefined;
    const range = doc?.contents?.range;
    if (!doc || !range) throw new Error(`Could not read ${vscode.workspace.asRelativePath(entry.uri)}.`);
    const desiredAfter = toDesiredState(after);
    // Without a base, take the repository's own content as one so only real differences are applied.
    const base = before ? toDesiredState(before) : (doc.toJS() as Record<string, unknown>);
    for (const change of changedPaths(base, desiredAfter)) {
      if (change.deleted) doc.deleteIn(change.path);
      else doc.setIn(change.path, change.value);
    }
    const copy = doc.clone();
    copy.commentBefore = null;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      entry.uri,
      new vscode.Range(document.positionAt(range[0]), document.positionAt(range[2])),
      copy.toString({ lineWidth: 0 }),
    );
    await vscode.workspace.applyEdit(edit);
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    const start = new vscode.Position(entry.line, 0);
    editor.revealRange(new vscode.Range(start, start), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    return entry.uri;
  }

  private async createFile(after: Record<string, unknown>): Promise<vscode.Uri | undefined> {
    const suggested = this.suggestPath(after);
    if (!suggested) throw new Error('Open the GitOps repository in this window first.');
    const target = await vscode.window.showSaveDialog({
      defaultUri: suggested,
      filters: { YAML: ['yaml', 'yml'] },
      title: 'Where should this resource live in the GitOps repository?',
    });
    if (!target) return undefined;
    const content = stringify(toDesiredState(after), { lineWidth: 0 });
    const exists = await vscode.workspace.fs.stat(target).then(() => true, () => false);
    const edit = new vscode.WorkspaceEdit();
    if (exists) {
      const document = await vscode.workspace.openTextDocument(target);
      const text = document.getText();
      edit.insert(target, document.positionAt(text.length), `${text.endsWith('\n') ? '' : '\n'}---\n${content}`);
    } else {
      edit.createFile(target, { ignoreIfExists: true });
      edit.insert(target, new vscode.Position(0, 0), content);
    }
    await vscode.workspace.applyEdit(edit);
    await vscode.window.showTextDocument(target, { preview: false });
    return target;
  }

  /**
   * Where a new resource would go: next to the closest existing resource
   * (same component, then project, then namespace, then kind), else at the
   * repository root.
   */
  suggestPath(resource: Record<string, unknown>): vscode.Uri | undefined {
    const kind = String(resource.kind);
    const meta = (resource.metadata ?? {}) as { name?: string; namespace?: string; labels?: Record<string, string> };
    const spec = (resource.spec ?? {}) as { owner?: { projectName?: string; componentName?: string } };
    const fileName = `${meta.name}.yaml`;
    const component = spec.owner?.componentName ?? meta.labels?.['openchoreo.dev/component'];
    const project = spec.owner?.projectName ?? meta.labels?.['openchoreo.dev/project'];
    const entries = this.entries();
    const pick = (pred: (e: RepoEntry) => boolean) => entries.find(pred);
    const near =
      (component && pick((e) => e.kind === 'Component' && e.name === component)) ||
      (component && pick((e) => e.uri.path.includes(`/${component}/`))) ||
      (project && pick((e) => e.kind === 'Project' && e.name === project)) ||
      pick((e) => e.kind === kind && (!meta.namespace || !e.namespace || e.namespace === meta.namespace)) ||
      pick((e) => !!meta.namespace && e.namespace === meta.namespace);
    if (near) return vscode.Uri.file(path.join(path.dirname(near.uri.fsPath), fileName));
    const folder = [...this.repoFolders][0] ?? vscode.workspace.workspaceFolders?.[0]?.uri.toString();
    return folder ? vscode.Uri.joinPath(vscode.Uri.parse(folder), fileName) : undefined;
  }

  private queue(uri: vscode.Uri): void {
    if (/[\\/](node_modules|\.git)[\\/]/.test(uri.fsPath)) return;
    this.pending.add(uri.toString());
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const uris = [...this.pending].map((u) => vscode.Uri.parse(u));
      this.pending.clear();
      void Promise.all(uris.map((u) => this.indexFile(u))).then(() => this.publish());
    }, 300);
  }

  private async indexFile(uri: vscode.Uri): Promise<void> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.byteLength > 1_000_000) return;
      const relativePath = vscode.workspace.asRelativePath(uri, false);
      const entries = entriesFromText(new TextDecoder().decode(bytes), uri, relativePath);
      if (entries.length) this.byFile.set(uri.toString(), entries);
      else this.byFile.delete(uri.toString());
    } catch {
      this.byFile.delete(uri.toString());
    }
  }

  private publish(): void {
    this.repoFolders.clear();
    for (const entries of this.byFile.values()) {
      for (const e of entries) {
        const folder = vscode.workspace.getWorkspaceFolder(e.uri);
        if (folder && !isAppManifest(vscode.workspace.asRelativePath(e.uri, false))) {
          this.repoFolders.add(folder.uri.toString());
        }
      }
    }
    void vscode.commands.executeCommand('setContext', 'openchoreo.gitopsRepository', this.hasRepository);
    this.changed.fire();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
  }
}

export interface PathChange {
  path: (string | number)[];
  value?: unknown;
  deleted?: boolean;
}

/** Leaf-level differences from `before` to `after`; arrays are compared whole. */
export function changedPaths(before: unknown, after: unknown, prefix: (string | number)[] = []): PathChange[] {
  if (isPlainObject(before) && isPlainObject(after)) {
    const changes: PathChange[] = [];
    for (const key of Object.keys(after)) {
      if (!(key in before)) changes.push({ path: [...prefix, key], value: after[key] });
      else changes.push(...changedPaths(before[key], after[key], [...prefix, key]));
    }
    for (const key of Object.keys(before)) {
      if (!(key in after)) changes.push({ path: [...prefix, key], deleted: true });
    }
    return changes;
  }
  return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ path: prefix, value: after }];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

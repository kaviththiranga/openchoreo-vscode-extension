// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Compare a resource in the GitOps repository with the cluster, both ways:
 * from a YAML file (editor title, Explorer) and from a tree node. The cluster
 * side is the resource's desired state (no status or server-set metadata),
 * with keys in the file's order so the diff shows only real differences.
 */
import * as vscode from 'vscode';
import { parse as parseYaml, parseAllDocuments, stringify } from 'yaml';
import type { ApiClientManager } from '../api/apiClient';
import { kindSpec } from '../kinds/registry';
import { fetchResource } from '../services/apiRoutes';
import { ResourceService } from '../services/resourceService';
import type { ResourceNodeData } from '../treeView/types';
import { toDesiredState } from './managed';
import type { GitOpsRepoIndex, RepoEntry } from './repoIndex';

export const LIVE_SCHEME = 'openchoreo-live';

export interface ResourceKey {
  kind: string;
  name: string;
  namespace?: string;
}

/** `openchoreo-live:/<kind>/<namespace or _cluster>/<name>.yaml?<file the keys follow>` */
export function liveUri(key: ResourceKey, orderFrom?: vscode.Uri, docIndex = 0): vscode.Uri {
  return vscode.Uri.from({
    scheme: LIVE_SCHEME,
    path: `/${key.kind}/${key.namespace ?? '_cluster'}/${key.name}.yaml`,
    query: orderFrom ? new URLSearchParams({ file: orderFrom.toString(), doc: String(docIndex) }).toString() : '',
  });
}

export function parseLiveUri(uri: vscode.Uri): { key: ResourceKey; orderFrom?: vscode.Uri; docIndex: number } {
  const [, kind, ns, file] = uri.path.split('/');
  const query = new URLSearchParams(uri.query);
  const from = query.get('file');
  return {
    key: { kind, namespace: ns === '_cluster' ? undefined : ns, name: (file ?? '').replace(/\.yaml$/, '') },
    orderFrom: from ? vscode.Uri.parse(from) : undefined,
    docIndex: Number(query.get('doc') ?? 0),
  };
}

/** Reorder `value`'s keys to follow `reference` where both have them; extra keys keep their order after. */
export function alignKeys(value: unknown, reference: unknown): unknown {
  if (Array.isArray(value)) {
    return Array.isArray(reference) ? value.map((v, i) => alignKeys(v, reference[i])) : value;
  }
  if (!value || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  const ref = reference && typeof reference === 'object' && !Array.isArray(reference) ? (reference as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(ref)) if (key in obj) out[key] = alignKeys(obj[key], ref[key]);
  for (const key of Object.keys(obj)) if (!(key in out)) out[key] = alignKeys(obj[key], undefined);
  return out;
}

/** The live side's YAML: desired state, keys in the reference's order. */
export function liveYaml(live: Record<string, unknown>, reference?: unknown): string {
  const desired = toDesiredState(live);
  return stringify(reference ? alignKeys(desired, reference) : desired, { lineWidth: 0 });
}

class LiveContentProvider implements vscode.TextDocumentContentProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly apiClientManager: ApiClientManager) {}

  refresh(uri: vscode.Uri): void {
    this.emitter.fire(uri);
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const { key, orderFrom, docIndex } = parseLiveUri(uri);
    let live: Record<string, unknown> | undefined;
    try {
      live = await fetchLive(this.apiClientManager, key);
    } catch (err) {
      return `# Could not read ${key.kind} "${key.name}" from the cluster: ${err instanceof Error ? err.message : err}\n`;
    }
    if (!live) return `# ${key.kind} "${key.name}" does not exist on the cluster.\n`;
    let reference: unknown;
    if (orderFrom) {
      const text = (await vscode.workspace.openTextDocument(orderFrom)).getText();
      reference = parseAllDocuments(text)[docIndex]?.toJS();
    }
    return liveYaml(live, reference);
  }
}

/** The resource from the API, or undefined when it doesn't exist. */
export async function fetchLive(
  apiClientManager: ApiClientManager,
  key: ResourceKey,
): Promise<Record<string, unknown> | undefined> {
  const spec = kindSpec(key.kind);
  if (!spec?.nodeType) throw new Error(`The OpenChoreo API doesn't serve ${key.kind}.`);
  const client = await apiClientManager.getClient();
  if (!client) throw new Error('Not connected to OpenChoreo. Run "OpenChoreo: Login" first.');
  const namespace = spec.scope === 'cluster' ? null : key.namespace ?? currentNamespace() ?? null;
  try {
    const live = (await fetchResource(client, spec.nodeType, namespace, key.name)) as Record<string, unknown>;
    if (!live.apiVersion) {
      live.apiVersion = 'openchoreo.dev/v1alpha1';
      live.kind = key.kind;
    }
    return live;
  } catch (err) {
    if (err instanceof Error && /not[_ ]?found|404/i.test(err.message)) return undefined;
    if (err instanceof Error && /forbidden|403/i.test(err.message)) {
      throw new Error("your OpenChoreo role doesn't allow reading it");
    }
    throw err;
  }
}

let currentNamespace: () => string | undefined = () => undefined;

/** The resource declared at the cursor (or the first one) in a YAML document. */
export function resourceAt(text: string, offset?: number): (ResourceKey & { docIndex: number }) | undefined {
  const docs = parseAllDocuments(text);
  const candidates = docs
    .map((doc, docIndex) => ({ doc, docIndex, value: doc.toJS() as Record<string, unknown> | null }))
    .filter(({ value }) => typeof value?.apiVersion === 'string' && value.apiVersion.startsWith('openchoreo.dev/'));
  if (candidates.length === 0) return undefined;
  const hit =
    offset === undefined
      ? candidates[0]
      : candidates.find(({ doc }) => {
          const range = doc.contents?.range;
          return range && offset >= range[0] && offset <= range[2];
        }) ?? candidates[0];
  const meta = (hit.value?.metadata ?? {}) as { name?: string; namespace?: string };
  if (!meta.name) return undefined;
  return { kind: String(hit.value?.kind), name: meta.name, namespace: meta.namespace, docIndex: hit.docIndex };
}

export function registerCompareCommands(
  context: vscode.ExtensionContext,
  deps: {
    apiClientManager: ApiClientManager;
    repoIndex: GitOpsRepoIndex;
    namespace: () => string | undefined;
    resolveNode: (arg: unknown) => ResourceNodeData | undefined;
  },
): void {
  currentNamespace = deps.namespace;
  const provider = new LiveContentProvider(deps.apiClientManager);

  const compareFile = async (uri: vscode.Uri, offset?: number) => {
    const document = await vscode.workspace.openTextDocument(uri);
    const resource = resourceAt(document.getText(), offset);
    if (!resource) {
      vscode.window.showWarningMessage('This file declares no OpenChoreo resource (apiVersion openchoreo.dev/…).');
      return;
    }
    if (!kindSpec(resource.kind)?.nodeType) {
      vscode.window.showWarningMessage(`The OpenChoreo API doesn't serve ${resource.kind}, so it can't be compared.`);
      return;
    }
    const entryNamespace = deps.repoIndex.find(resource.kind, resource.name, resource.namespace)[0]?.namespace;
    const key = { ...resource, namespace: resource.namespace ?? entryNamespace };
    const live = liveUri(key, uri, resource.docIndex);
    provider.refresh(live);
    await vscode.commands.executeCommand(
      'vscode.diff',
      live,
      uri,
      `${resource.name} (cluster) ↔ ${vscode.workspace.asRelativePath(uri)}`,
      { preview: true },
    );
  };

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(LIVE_SCHEME, provider),

    vscode.commands.registerCommand('openchoreo.compareWithCluster', async (arg?: unknown) => {
      try {
        const editor = vscode.window.activeTextEditor;
        const viewEntry = (arg as { kind?: string; entry?: RepoEntry } | undefined)?.kind === 'entry' ? (arg as { entry: RepoEntry }).entry : undefined;
        if (viewEntry) {
          const document = await vscode.workspace.openTextDocument(viewEntry.uri);
          await compareFile(viewEntry.uri, document.offsetAt(new vscode.Position(viewEntry.line, 0)));
        } else if (arg instanceof vscode.Uri) {
          const offset = editor?.document.uri.toString() === arg.toString() ? editor.document.offsetAt(editor.selection.active) : undefined;
          await compareFile(arg, offset);
        } else if (editor) {
          await compareFile(editor.document.uri, editor.document.offsetAt(editor.selection.active));
        } else {
          vscode.window.showWarningMessage('Open an OpenChoreo YAML file to compare it with the cluster.');
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Compare with Cluster failed: ${err instanceof Error ? err.message : err}`);
      }
    }),

    vscode.commands.registerCommand('openchoreo.compareWithRepository', async (arg: unknown) => {
      const node = deps.resolveNode(arg);
      const kind = node && new ResourceService().getCrdKind(node.type);
      const name = node?.resourceName ?? node?.label;
      if (!node || !kind || !name) return;
      await deps.repoIndex.whenReady();
      const entries = deps.repoIndex.find(kind, name, node.namespace);
      if (entries.length === 0) {
        const repo = deps.repoIndex.hasRepository;
        vscode.window.showInformationMessage(
          repo
            ? `${kind} "${name}" isn't declared in the GitOps repository open in this window.`
            : 'Open your GitOps repository in this window to compare the cluster with it.',
        );
        return;
      }
      const entry: RepoEntry =
        entries.length === 1
          ? entries[0]
          : ((await vscode.window.showQuickPick(
              entries.map((e) => ({ label: vscode.workspace.asRelativePath(e.uri), entry: e })),
              { placeHolder: `${kind} "${name}" is declared more than once` },
            ))?.entry as RepoEntry);
      if (!entry) return;
      const live = liveUri({ kind, name, namespace: node.namespace }, entry.uri, entry.docIndex);
      provider.refresh(live);
      await vscode.commands.executeCommand(
        'vscode.diff',
        live,
        entry.uri,
        `${name} (cluster) ↔ ${vscode.workspace.asRelativePath(entry.uri)}`,
        { preview: true, selection: new vscode.Range(entry.line, 0, entry.line, 0) },
      );
    }),
  );
}

/** Parse a YAML document's text into a resource object, or undefined. */
export function parseResource(text: string): Record<string, unknown> | undefined {
  try {
    const value = parseYaml(text);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

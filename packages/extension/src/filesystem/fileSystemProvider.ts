// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { parse as parseYaml } from 'yaml';
import type { ApiClientManager } from '../api/apiClient';
import type { ResourceNodeData, ResourceNodeType } from '../treeView/types';
import { ResourceService } from '../services/resourceService';
import { DEFINITION_RESOURCE_TYPES, crdToYaml } from '../services/yamlService';
import { buildPutRequest, buildPostRequest, fetchResource } from '../services/apiRoutes';
import { log } from '../logging/logger';

export const FS_SCHEME = 'openchoreo';

/**
 * Parsed components of an openchoreo:// URI.
 */
interface ResourceUri {
  /** Namespace, or null for cluster-scoped resources. */
  namespace: string | null;
  /** ResourceNodeType (e.g. 'component', 'workflow', 'cluster-workflow'). */
  type: ResourceNodeType;
  /** Resource name. */
  name: string;
  /** Whether this resource should be opened as readonly. */
  readonly: boolean;
}

/**
 * Build an openchoreo:// URI for a resource node.
 *
 * Format:
 *   openchoreo:/{namespace}/{type}/{name}.yaml
 *   openchoreo:/_cluster/{type}/{name}.yaml       (cluster-scoped)
 *   ?readonly appended for non-editable resources
 */
/**
 * Build an openchoreo:// URI for a resource node.
 *
 * Format:
 *   openchoreo:/namespaces/{namespace}/{type}/{name}.yaml   (namespace-scoped)
 *   openchoreo:/{type}/{name}.yaml                          (cluster-scoped)
 *   ?readonly appended for non-editable resources
 */
export function buildResourceUri(node: ResourceNodeData): vscode.Uri {
  const resourceService = new ResourceService();
  const isCluster = resourceService.isClusterScoped(node.type);
  const isDeleting = node.description?.includes('(deleting)') ?? false;
  const isEditable = !isDeleting && DEFINITION_RESOURCE_TYPES.has(node.type);

  const name = node.resourceName ?? node.label;
  const path = isCluster
    ? `/${node.type}/${name}.yaml`
    : `/namespaces/${node.namespace ?? 'default'}/${node.type}/${name}.yaml`;
  const query = isEditable ? '' : 'readonly';

  return vscode.Uri.from({
    scheme: FS_SCHEME,
    path,
    query,
  });
}

/**
 * Parse an openchoreo:// URI back into its resource components.
 *
 * Formats:
 *   /namespaces/{namespace}/{type}/{name}.yaml   → namespace-scoped
 *   /{type}/{name}.yaml                          → cluster-scoped
 */
function parseResourceUri(uri: vscode.Uri): ResourceUri {
  const segments = uri.path.split('/').filter(Boolean);

  // Namespace-scoped: namespaces/{ns}/{type}/{name}.yaml
  if (segments[0] === 'namespaces' && segments.length >= 4) {
    return {
      namespace: segments[1],
      type: segments[2] as ResourceNodeType,
      name: segments[3].replace(/\.yaml$/, ''),
      readonly: uri.query === 'readonly',
    };
  }

  // Cluster-scoped: {type}/{name}.yaml
  if (segments.length >= 2) {
    return {
      namespace: null,
      type: segments[0] as ResourceNodeType,
      name: segments[1].replace(/\.yaml$/, ''),
      readonly: uri.query === 'readonly',
    };
  }

  throw vscode.FileSystemError.FileNotFound(uri);
}

/**
 * Virtual FileSystemProvider that maps openchoreo:// URIs to API resources.
 *
 * - readFile: GET resource from API, return as YAML
 * - writeFile: PUT resource to API (Cmd+S), with 409 conflict detection
 * - stat: returns file metadata, readonly flag for non-definition resources
 */
export class OpenChoreoFileSystemProvider implements vscode.FileSystemProvider {
  private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  private readonly resourceService = new ResourceService();

  /** Scaffold content for new resources — keyed by URI string. */
  private readonly pendingContent = new Map<string, Uint8Array>();

  /** URIs that represent new (not-yet-created) resources — use POST instead of PUT. */
  private readonly newResources = new Set<string>();

  constructor(
    private readonly apiClientManager: ApiClientManager,
    private readonly onResourceSaved?: () => void,
  ) {}

  /** Store scaffold content for a URI so readFile returns it instead of fetching from API. */
  setPendingContent(uri: vscode.Uri, content: string): void {
    this.pendingContent.set(uri.toString(), new TextEncoder().encode(content));
    this.newResources.add(uri.toString());
  }

  /** Store read-only content for a URI (no POST tracking). */
  setReadonlyContent(uri: vscode.Uri, content: string): void {
    this.pendingContent.set(uri.toString(), new TextEncoder().encode(content));
  }

  watch(): vscode.Disposable {
    // No-op: we don't poll for remote changes.
    return new vscode.Disposable(() => {});
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const parsed = parseResourceUri(uri);

    const stat: vscode.FileStat = {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: Date.now(),
      size: 0,
    };

    if (parsed.readonly) {
      stat.permissions = vscode.FilePermission.Readonly;
    }

    return stat;
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    // Return pending scaffold content for new resources
    const pending = this.pendingContent.get(uri.toString());
    if (pending) {
      this.pendingContent.delete(uri.toString());
      return pending;
    }

    const parsed = parseResourceUri(uri);

    try {
      const client = await this.apiClientManager.getClient();
      if (!client) {
        throw vscode.FileSystemError.Unavailable('Not authenticated. Run "occ login" first.');
      }

      log.debug(`Reading resource: ${parsed.type}/${parsed.name} in ${parsed.namespace ?? 'cluster'}`);
      const crd = (await fetchResource(
        client,
        parsed.type,
        parsed.namespace,
        parsed.name,
      )) as Record<string, unknown>;

      // Inject apiVersion + kind if missing (API responses may omit them)
      if (!crd.apiVersion) {
        const kind = this.resourceService.getCrdKind(parsed.type);
        if (kind) {
          crd.apiVersion = 'openchoreo.dev/v1alpha1';
          crd.kind = kind;
        }
      }

      const yamlContent = crdToYaml(crd);
      return new TextEncoder().encode(yamlContent);
    } catch (err) {
      if (err instanceof vscode.FileSystemError) {
        throw err;
      }
      log.error(`Failed to read resource: ${parsed.type}/${parsed.name}`, err);
      throw vscode.FileSystemError.Unavailable(
        `Failed to load resource: ${err instanceof Error ? err.message : 'Connection error'}`,
      );
    }
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    _options: { create: boolean; overwrite: boolean },
  ): Promise<void> {
    const parsed = parseResourceUri(uri);

    if (parsed.readonly) {
      throw vscode.FileSystemError.NoPermissions('This resource is read-only.');
    }

    const yamlStr = new TextDecoder().decode(content);
    let resource: Record<string, unknown>;
    try {
      resource = parseYaml(yamlStr) as Record<string, unknown>;
    } catch {
      throw vscode.FileSystemError.Unavailable(
        'Failed to parse YAML. Fix syntax errors and try again.',
      );
    }

    if (
      resource?.apiVersion !== 'openchoreo.dev/v1alpha1' ||
      typeof resource?.kind !== 'string'
    ) {
      throw vscode.FileSystemError.Unavailable(
        'Document must have apiVersion: openchoreo.dev/v1alpha1 and a kind field.',
      );
    }

    const kind = resource.kind as string;
    const metadata = resource.metadata as
      | { name?: string; namespace?: string }
      | undefined;
    const name = metadata?.name;
    const ns = metadata?.namespace ?? '';

    if (!name) {
      throw vscode.FileSystemError.Unavailable('Resource metadata.name is required.');
    }

    const client = await this.apiClientManager.getClient();
    if (!client) {
      throw vscode.FileSystemError.Unavailable('Not authenticated. Run "occ login" first.');
    }

    const isNew = this.newResources.has(uri.toString());

    let error: unknown;
    let response: { status?: number } | undefined;

    if (isNew) {
      // New resource — use POST to create
      const postReq = buildPostRequest(kind, ns, resource);
      if (!postReq) {
        throw vscode.FileSystemError.Unavailable(
          `Unknown resource kind: ${kind}. Cannot determine API endpoint.`,
        );
      }

      const result = await client.POST(postReq.path as never, {
        params: postReq.params,
        body: postReq.body,
      } as never);
      error = result.error;
      response = result.response as { status?: number } | undefined;
    } else {
      // Existing resource — use PUT to update
      const putReq = buildPutRequest(kind, name, ns, resource);
      if (!putReq) {
        throw vscode.FileSystemError.Unavailable(
          `Unknown resource kind: ${kind}. Cannot determine API endpoint.`,
        );
      }

      const result = await client.PUT(putReq.path as never, {
        params: putReq.params,
        body: putReq.body,
      } as never);
      error = result.error;
      response = result.response as { status?: number } | undefined;
    }

    if (error) {
      const status = response?.status;

      if (status === 409) {
        const msg = isNew
          ? `Resource '${name}' already exists on the cluster.`
          : 'Resource was modified on the cluster since you opened it. Reopen to get the latest version.';
        if (!isNew) {
          const action = await vscode.window.showErrorMessage(msg, 'Reopen');
          if (action === 'Reopen') {
            this._onDidChangeFile.fire([
              { type: vscode.FileChangeType.Changed, uri },
            ]);
          }
        } else {
          vscode.window.showErrorMessage(msg);
        }
        throw vscode.FileSystemError.Unavailable(msg);
      }

      if (status === 404 && !isNew) {
        throw vscode.FileSystemError.FileNotFound('Resource no longer exists on the cluster.');
      }

      const msg =
        typeof error === 'object' && error !== null && 'message' in error
          ? (error as { message: string }).message
          : JSON.stringify(error);
      throw vscode.FileSystemError.Unavailable(`Failed to save resource: ${msg}`);
    }

    // Success
    if (isNew) {
      this.newResources.delete(uri.toString());
      vscode.window.showInformationMessage(`${kind} '${name}' created on cluster.`);

      // Reopen with the correct URI based on the actual resource name
      const parsed = parseResourceUri(uri);
      const correctPath = parsed.namespace
        ? `/namespaces/${parsed.namespace}/${parsed.type}/${name}.yaml`
        : `/${parsed.type}/${name}.yaml`;
      const correctUri = vscode.Uri.from({
        scheme: FS_SCHEME,
        path: correctPath,
        query: uri.query,
      });

      // Close old tab and open the correct one (async, non-blocking)
      setTimeout(async () => {
        try {
          // Close the current editor with the placeholder name
          await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
          // Open the created resource from the cluster
          const doc = await vscode.workspace.openTextDocument(correctUri);
          if (doc.languageId !== 'yaml') {
            await vscode.languages.setTextDocumentLanguage(doc, 'yaml');
          }
          await vscode.window.showTextDocument(doc);
        } catch (err) {
          log.error('Failed to reopen resource after create', err);
        }
      }, 100);
    } else {
      vscode.window.showInformationMessage(`${kind} '${name}' updated on cluster.`);
    }

    // Notify VSCode that the file changed — triggers readFile() which
    // re-fetches from the API, reflecting any server-side normalization
    // (e.g., removed default values, added status fields).
    // Small delay to let the backend finish processing the write.
    setTimeout(() => {
      this._onDidChangeFile.fire([
        { type: vscode.FileChangeType.Changed, uri },
      ]);
    }, 300);

    // Refresh tree views
    this.onResourceSaved?.();
  }

  // --- Unsupported operations ---

  readDirectory(): [string, vscode.FileType][] {
    throw vscode.FileSystemError.NoPermissions('Not supported');
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions('Not supported');
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions('Use the tree view Delete command instead.');
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions('Not supported');
  }
}

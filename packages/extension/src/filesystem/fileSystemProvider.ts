// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { parse as parseYaml } from 'yaml';
import type { ApiClientManager } from '../api/apiClient';
import type { ResourceNodeData, ResourceNodeType } from '../treeView/types';
import { ResourceService } from '../services/resourceService';
import { DEFINITION_RESOURCE_TYPES, crdToYaml } from '../services/yamlService';
import { buildPutRequest, fetchResource } from '../services/apiRoutes';
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
export function buildResourceUri(node: ResourceNodeData): vscode.Uri {
  const resourceService = new ResourceService();
  const isCluster = resourceService.isClusterScoped(node.type);
  const isEditable = DEFINITION_RESOURCE_TYPES.has(node.type);

  const nsSegment = isCluster ? '_cluster' : (node.namespace ?? 'default');
  const name = node.resourceName ?? node.label;
  const path = `/${nsSegment}/${node.type}/${name}.yaml`;
  const query = isEditable ? '' : 'readonly';

  return vscode.Uri.from({
    scheme: FS_SCHEME,
    path,
    query,
  });
}

/**
 * Parse an openchoreo:// URI back into its resource components.
 */
function parseResourceUri(uri: vscode.Uri): ResourceUri {
  // path: /{namespace-or-_cluster}/{type}/{name}.yaml
  const segments = uri.path.split('/').filter(Boolean);
  if (segments.length < 3) {
    throw vscode.FileSystemError.FileNotFound(uri);
  }

  const nsSegment = segments[0];
  const type = segments[1] as ResourceNodeType;
  const fileName = segments[2];
  const name = fileName.replace(/\.yaml$/, '');

  return {
    namespace: nsSegment === '_cluster' ? null : nsSegment,
    type,
    name,
    readonly: uri.query === 'readonly',
  };
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

  constructor(
    private readonly apiClientManager: ApiClientManager,
    private readonly onResourceSaved?: () => void,
  ) {}

  /** Store scaffold content for a URI so readFile returns it instead of fetching from API. */
  setPendingContent(uri: vscode.Uri, content: string): void {
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

    const putReq = buildPutRequest(kind, name, ns, resource);
    if (!putReq) {
      throw vscode.FileSystemError.Unavailable(
        `Unknown resource kind: ${kind}. Cannot determine API endpoint.`,
      );
    }

    const { error, response } = await client.PUT(putReq.path as never, {
      params: putReq.params,
      body: putReq.body,
    } as never);

    if (error) {
      const status = (response as { status?: number } | undefined)?.status;

      if (status === 409) {
        // Conflict — resource was modified on the cluster
        const action = await vscode.window.showErrorMessage(
          'Resource was modified on the cluster since you opened it. Reopen to get the latest version.',
          'Reopen',
        );
        if (action === 'Reopen') {
          // Fire change event so VSCode re-reads the file
          this._onDidChangeFile.fire([
            { type: vscode.FileChangeType.Changed, uri },
          ]);
        }
        throw vscode.FileSystemError.Unavailable('Conflict: resource was modified on the cluster.');
      }

      if (status === 404) {
        throw vscode.FileSystemError.FileNotFound('Resource no longer exists on the cluster.');
      }

      const msg =
        typeof error === 'object' && error !== null && 'message' in error
          ? (error as { message: string }).message
          : JSON.stringify(error);
      throw vscode.FileSystemError.Unavailable(`Failed to save resource: ${msg}`);
    }

    // Success — notify VSCode that the file changed (updates mtime)
    this._onDidChangeFile.fire([
      { type: vscode.FileChangeType.Changed, uri },
    ]);

    vscode.window.showInformationMessage(`${kind} '${name}' saved to cluster.`);

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

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { ApiClientManager } from '../api/apiClient';
import type { ResourceNodeType } from '../treeView/types';
import { itemPathParams, kindSpecForNode } from '../kinds/registry';

type Client = NonNullable<
  Awaited<ReturnType<ApiClientManager['getClient']>>
>;

export class ResourceService {
  /** PascalCase CRD kind for a tree node type (used by apply / YAML editing). */
  getCrdKind(nodeType: ResourceNodeType): string | undefined {
    return kindSpecForNode(nodeType)?.kind;
  }

  isClusterScoped(nodeType: ResourceNodeType): boolean {
    return kindSpecForNode(nodeType)?.scope === 'cluster';
  }

  /** Deletes a resource using its per-resource DELETE endpoint. */
  async deleteResource(
    client: Client,
    nodeType: ResourceNodeType,
    namespace: string | undefined,
    name: string,
  ): Promise<void> {
    const spec = kindSpecForNode(nodeType);
    if (!spec?.delete) {
      throw new Error(`Delete not supported for resource type: ${nodeType}`);
    }
    const { error } = await client.DELETE(spec.itemPath as never, {
      params: { path: itemPathParams(spec, namespace, name) },
    } as never);
    if (error) {
      throw new Error(`Failed to delete ${spec.label.toLowerCase()}: ${JSON.stringify(error)}`);
    }
  }
}

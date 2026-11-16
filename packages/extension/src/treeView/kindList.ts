// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { ApiClientManager } from '../api/apiClient';
import { collectionPathParams, kindSpec } from '../kinds/registry';
import type { ResourceNodeData, ResourceNodeType } from './types';

type Client = NonNullable<Awaited<ReturnType<ApiClientManager['getClient']>>>;
type ListItem = {
  metadata?: { name?: string; deletionTimestamp?: string };
  spec?: { environment?: string };
};

export interface KindListOptions {
  namespace?: string;
  /** Extra query parameters (e.g. `{ project }`) for the list call. */
  query?: Record<string, string>;
  /** Context value for a live (not deleting) node of this type. */
  contextValueFor: (type: ResourceNodeType) => string;
  /** Fields copied onto every node (e.g. `project`). */
  nodeExtras?: Partial<ResourceNodeData>;
}

/**
 * Lists a registry kind as leaf tree nodes. Kinds newer than the connected
 * control plane come back 404 and render as a version hint instead of an
 * empty list.
 */
export async function fetchKindNodes(
  client: Client,
  kind: string,
  opts: KindListOptions,
): Promise<ResourceNodeData[]> {
  const spec = kindSpec(kind);
  if (!spec?.nodeType) return [];
  const nodeType = spec.nodeType;

  const { data, error, response } = (await client.GET(spec.collectionPath as never, {
    params: { path: collectionPathParams(spec, opts.namespace), query: opts.query },
  } as never)) as { data?: { items?: ListItem[] }; error?: unknown; response?: Response };

  if (error) {
    if (response?.status === 404 && spec.since) {
      return [placeholder(`Requires OpenChoreo ${spec.since.join('.')}+`)];
    }
    return [];
  }

  const items = data?.items ?? [];
  if (items.length === 0) {
    return [placeholder(`No ${spec.label.toLowerCase()}s`)];
  }

  return items.map((item) => {
    const isDeleting = !!item.metadata?.deletionTimestamp;
    const env = item.spec?.environment;
    const name = item.metadata?.name ?? 'unknown';
    return {
      label: name,
      type: nodeType,
      contextValue: isDeleting ? nodeType : opts.contextValueFor(nodeType),
      description: isDeleting ? (env ? `${env} (deleting)` : '(deleting)') : env,
      namespace: opts.namespace,
      resourceName: name,
      childrenMode: 'none' as const,
      ...opts.nodeExtras,
    };
  });
}

function placeholder(label: string): ResourceNodeData {
  return { label, type: 'empty', contextValue: 'empty', childrenMode: 'none' };
}

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { ApiClientManager } from '../api/apiClient';
import {
  collectionPathParams,
  itemPathParams,
  kindSpec,
  kindSpecForNode,
} from '../kinds/registry';

type Client = NonNullable<
  Awaited<ReturnType<ApiClientManager['getClient']>>
>;

interface ApiRequest {
  path: string;
  params: { path: Record<string, string> };
  body: unknown;
}

/** API bodies are `{ metadata, spec, ... }` — drop the CRD envelope fields. */
function stripEnvelope(body: Record<string, unknown>): Record<string, unknown> {
  const { apiVersion: _a, kind: _k, ...rest } = body;
  return rest;
}

/**
 * Builds the PUT (update) request for a resource of the given CRD kind.
 * Returns null when the kind is unknown or not updatable.
 */
export function buildPutRequest(
  kind: string,
  name: string,
  ns: string,
  body: Record<string, unknown>,
): ApiRequest | null {
  const spec = kindSpec(kind);
  if (!spec?.update) return null;
  return {
    path: spec.itemPath,
    params: { path: itemPathParams(spec, ns, name) },
    body: stripEnvelope(body),
  };
}

/**
 * Builds the POST (create) request for a resource of the given CRD kind.
 * Targets the collection endpoint (no resource name in path).
 */
export function buildPostRequest(
  kind: string,
  ns: string,
  body: Record<string, unknown>,
): ApiRequest | null {
  const spec = kindSpec(kind);
  if (!spec?.create) return null;
  return {
    path: spec.collectionPath,
    params: { path: collectionPathParams(spec, ns) },
    body: stripEnvelope(body),
  };
}

/**
 * Fetches a single resource from the API by tree node type, namespace, and name.
 * Returns the raw API response object.
 */
export async function fetchResource(
  client: Client,
  type: string,
  ns: string | null,
  name: string | null,
): Promise<unknown> {
  if (type === 'namespace') {
    if (!ns) throw new Error('Namespace name required');
    const { data, error } = await client.GET('/api/v1/namespaces/{namespaceName}', {
      params: { path: { namespaceName: ns } },
    });
    if (error) throw new Error(`Failed to fetch namespace: ${JSON.stringify(error)}`);
    return data;
  }

  const spec = kindSpecForNode(type);
  if (!spec) throw new Error(`Unknown resource type: ${type}`);
  const label = spec.label.toLowerCase();
  if (!name || (spec.scope === 'namespace' && !ns)) {
    throw new Error(
      spec.scope === 'namespace'
        ? `Namespace and name required for ${label}`
        : `Name required for ${label}`,
    );
  }

  // Registry paths are checked against the client's route union; the
  // per-route parameter shapes are uniform ({namespaceName?, <nameParam>}).
  const { data, error } = await client.GET(spec.itemPath as never, {
    params: { path: itemPathParams(spec, ns ?? undefined, name) },
  } as never);
  if (error) throw new Error(`Failed to fetch ${label}: ${JSON.stringify(error)}`);
  return data;
}

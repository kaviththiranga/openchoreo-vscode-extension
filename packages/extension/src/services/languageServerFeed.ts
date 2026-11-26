// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { buildResourceUri } from '../filesystem/fileSystemProvider';
import type { ResourceNodeData } from '../treeView/types';
import type { ManagedLanguageClient } from './occLanguageServer';
import type { OccConfigAuthProvider } from '../auth/authProvider';
import type { ApiClientManager } from '../api/apiClient';
import {
  collectionPathParams,
  kindSpec,
  PARAMETER_SCHEMA_KINDS,
  REFERENCE_TARGET_KINDS,
  type KindSpec,
} from '../kinds/registry';
import { log } from '../logging/logger';

type Client = NonNullable<Awaited<ReturnType<ApiClientManager['getClient']>>>;
type Item = { metadata?: { name?: string; namespace?: string }; spec?: Record<string, unknown> };

/**
 * Lists a kind's resources. Resolves to undefined when the list fails
 * (e.g. 403), so callers can tell "none exist" from "unknown".
 */
async function listItems(client: Client, spec: KindSpec, ns: string | undefined): Promise<Item[] | undefined> {
  if (spec.scope === 'namespace' && !ns) return undefined;
  try {
    const { data, error } = await client.GET(spec.collectionPath as never, {
      params: { path: collectionPathParams(spec, ns) },
    } as never);
    if (error) return undefined;
    const items = (data as { items?: unknown } | undefined)?.items;
    return Array.isArray(items) ? items as Item[] : undefined;
  } catch {
    return undefined;
  }
}

const itemName = (i: Item) => i.metadata?.name;

/**
 * Fetch names of every reference-target kind and push them to the language
 * server for value completions and reference checks. A kind whose list
 * failed is left out, which tells the server not to check against it.
 */
export async function pushResourceNames(
  langClient: ManagedLanguageClient,
  apiClientManager: ApiClientManager,
  authProvider: OccConfigAuthProvider,
  current: () => boolean = () => true,
  navigation?: {contextId: string | null; namespace: string | null; generation: number},
  /** Names declared in the workspace's GitOps repository, by kind. */
  repoNames?: (namespace: string | undefined) => Record<string, string[]>,
): Promise<void> {
  try {
    const client = await apiClientManager.getClient();
    if (!client || !current()) return;
    const ns = authProvider.getContextInfo()?.namespace;
    const resources: Record<string, string[]> = {};
    const fetched = new Map<string, Promise<Item[] | undefined>>();
    const itemsFor = (kind: string) => {
      if (!fetched.has(kind)) {
        const spec = kindSpec(kind);
        fetched.set(kind, spec ? listItems(client, spec, ns) : Promise.resolve(undefined));
      }
      return fetched.get(kind)!;
    };

    await Promise.allSettled([
      ...REFERENCE_TARGET_KINDS.map(async (kind) => {
        const spec = kindSpec(kind);
        const items = spec && (await itemsFor(kind));
        if (items) resources[kind] = items.map(itemName).filter((n): n is string => !!n);
      }),
      // Releases grouped by component for scoped completions
      (async () => {
        const spec = kindSpec('ComponentRelease');
        for (const item of (spec && (await itemsFor('ComponentRelease'))) ?? []) {
          const compName = (item.spec?.owner as { componentName?: string } | undefined)?.componentName;
          const relName = itemName(item);
          if (relName && compName) (resources[`ComponentRelease:${compName}`] ??= []).push(relName);
        }
      })(),
      client.GET('/api/v1/namespaces').then((r) => {
        if (r.data) resources['Namespace'] = (r.data.items ?? []).map(itemName).filter((n): n is string => !!n);
      }),
    ]);

    // Resources declared in Git but not synced yet are valid references too. Only kinds the
    // cluster could list are merged, so a kind we can't check still never warns.
    for (const [kind, names] of Object.entries(repoNames?.(ns) ?? {})) {
      if (resources[kind]) resources[kind] = [...new Set([...resources[kind], ...names])];
    }

    log.debug(`Pushing resource names to language server: ${Object.entries(resources).map(([k, v]) => `${k}(${v.length})`).join(', ')}`);
    if (current() && langClient.isRunning()) await langClient.sendNotification('openchoreo/updateResources', resources);
    if (navigation?.contextId && current() && langClient.isRunning()) {
      const locations: Array<Record<string, unknown>> = [];
      const completeKinds: string[] = [];
      for (const [kind, pending] of fetched) {
        const spec = kindSpec(kind);
        if (!spec?.nodeType) continue;
        const items = await pending;
        if (!items) continue;
        completeKinds.push(kind);
        for (const item of items) {
          if (!item.metadata?.name) continue;
          const namespace = spec.scope === 'namespace' ? item.metadata.namespace ?? ns : undefined;
          if (spec.scope === 'namespace' && !namespace) continue;
          const node = { type: spec.nodeType, label: item.metadata.name, resourceName: item.metadata.name, namespace } as ResourceNodeData;
          locations.push({
            kind, name: item.metadata.name, namespace,
            componentName: (item.spec?.owner as { componentName?: string } | undefined)?.componentName,
            workloadType: typeof item.spec?.workloadType === 'string' ? item.spec.workloadType : undefined,
            uri: buildResourceUri(node, navigation.contextId).toString(),
          });
        }
      }
      if (current() && langClient.isRunning()) {
        await langClient.sendNotification('openchoreo/updateResourceLocations', { ...navigation, resources: locations, completeKinds });
      }
    }
  } catch {
    log.debug('Could not refresh cluster resource-name suggestions.');
  }
}

/**
 * Fetch the `parameters` / `environmentConfigs` openAPIV3Schema of every
 * type-like resource (component/project/resource types, traits, workflows)
 * and push them for cross-document completions.
 */
export async function pushResourceSchemas(
  langClient: ManagedLanguageClient,
  apiClientManager: ApiClientManager,
  authProvider: OccConfigAuthProvider,
  current: () => boolean = () => true,
): Promise<void> {
  try {
    const client = await apiClientManager.getClient();
    if (!client || !current()) {
      log.debug('pushResourceSchemas: no API client');
      return;
    }
    const ns = authProvider.getContextInfo()?.namespace;

    // { kind: { resourceName: { parameters?, environmentConfigs? } } }
    const schemas: Record<string, Record<string, { parameters?: unknown; environmentConfigs?: unknown }>> = {};
    await Promise.allSettled(
      PARAMETER_SCHEMA_KINDS.map(async (spec) => {
        const items = await listItems(client, spec, ns);
        if (!items) return;
        const byName: (typeof schemas)[string] = {};
        for (const item of items) {
          const name = itemName(item);
          const s = item.spec as
            | { parameters?: { openAPIV3Schema?: unknown }; environmentConfigs?: { openAPIV3Schema?: unknown } }
            | undefined;
          if (name && s) {
            byName[name] = {
              parameters: s.parameters?.openAPIV3Schema,
              environmentConfigs: s.environmentConfigs?.openAPIV3Schema,
            };
          }
        }
        schemas[spec.kind] = byName;
      }),
    );

    const total = Object.values(schemas).reduce((sum, m) => sum + Object.keys(m).length, 0);
    log.debug(`Pushing resource schemas: ${total} total — ${Object.entries(schemas).map(([k, m]) => `${k}(${Object.keys(m).length})`).join(', ')}`);
    if (current() && langClient.isRunning()) await langClient.sendNotification('openchoreo/updateResourceSchemas', schemas);
  } catch {
    log.debug('Could not refresh cluster schema suggestions.');
  }
}

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { LanguageClient } from 'vscode-languageclient/node';
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
type Item = { metadata?: { name?: string }; spec?: Record<string, unknown> };

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
    return ((data as { items?: Item[] } | undefined)?.items ?? []) as Item[];
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
  langClient: LanguageClient,
  apiClientManager: ApiClientManager,
  authProvider: OccConfigAuthProvider,
): Promise<void> {
  try {
    const client = await apiClientManager.getClient();
    if (!client) return;
    const ns = authProvider.getContextInfo()?.namespace;
    const resources: Record<string, string[]> = {};

    await Promise.allSettled([
      ...REFERENCE_TARGET_KINDS.map(async (kind) => {
        const spec = kindSpec(kind);
        const items = spec && (await listItems(client, spec, ns));
        if (items) resources[kind] = items.map(itemName).filter((n): n is string => !!n);
      }),
      // Releases grouped by component for scoped completions
      (async () => {
        const spec = kindSpec('ComponentRelease');
        for (const item of (spec && (await listItems(client, spec, ns))) ?? []) {
          const compName = (item.spec?.owner as { componentName?: string } | undefined)?.componentName;
          const relName = itemName(item);
          if (relName && compName) (resources[`ComponentRelease:${compName}`] ??= []).push(relName);
        }
      })(),
      client.GET('/api/v1/namespaces').then((r) => {
        if (r.data) resources['Namespace'] = (r.data.items ?? []).map(itemName).filter((n): n is string => !!n);
      }),
    ]);

    log.debug(`Pushing resource names to language server: ${Object.entries(resources).map(([k, v]) => `${k}(${v.length})`).join(', ')}`);
    langClient.sendNotification('openchoreo/updateResources', resources);
  } catch {
    // Non-fatal — completions just won't have dynamic values
  }
}

/**
 * Fetch the `parameters` / `environmentConfigs` openAPIV3Schema of every
 * type-like resource (component/project/resource types, traits, workflows)
 * and push them for cross-document completions.
 */
export async function pushResourceSchemas(
  langClient: LanguageClient,
  apiClientManager: ApiClientManager,
  authProvider: OccConfigAuthProvider,
): Promise<void> {
  try {
    const client = await apiClientManager.getClient();
    if (!client) {
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
    langClient.sendNotification('openchoreo/updateResourceSchemas', schemas);
  } catch {
    // Non-fatal
  }
}

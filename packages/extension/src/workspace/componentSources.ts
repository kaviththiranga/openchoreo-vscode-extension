// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Components of the current namespace with where their source lives, read
 * from each component's workflow parameters through the workflow's
 * repository markers.
 */
import type { ApiClientManager } from '../api/apiClient';
import type { OccConfigAuthProvider } from '../auth/authProvider';
import { fetchResource } from '../services/apiRoutes';
import { log } from '../logging/logger';
import {
  componentSource,
  repositoryPaths,
  workflowParameterSchema,
  type ComponentSource,
  type RepositoryPaths,
} from './repositoryFields';

export interface WorkflowRef {
  kind: 'Workflow' | 'ClusterWorkflow';
  name: string;
}

export interface SourcedComponent extends ComponentSource {
  namespace: string;
  project: string;
  name: string;
  workflow?: WorkflowRef;
  /** Where the workflow keeps each git field, for building with overrides. */
  paths: RepositoryPaths;
  /** The component's current workflow parameters. */
  parameters: Record<string, unknown>;
  autoBuild: boolean;
}

interface ComponentItem {
  metadata?: { name?: string };
  spec?: {
    owner?: { projectName?: string };
    autoBuild?: boolean;
    workflow?: { kind?: string; name?: string; parameters?: Record<string, unknown> };
  };
}

export function workflowRef(spec: ComponentItem['spec']): WorkflowRef | undefined {
  const name = spec?.workflow?.name;
  if (!name) return undefined;
  return { kind: spec?.workflow?.kind === 'Workflow' ? 'Workflow' : 'ClusterWorkflow', name };
}

export class ComponentSourceService {
  private readonly pathsCache = new Map<string, Promise<RepositoryPaths>>();
  private listCache: { key: string; at: number; value: Promise<SourcedComponent[]> } | undefined;

  constructor(
    private readonly authProvider: OccConfigAuthProvider,
    private readonly apiClientManager: ApiClientManager,
  ) {
    authProvider.onDidChangeSession(() => this.invalidate());
  }

  invalidate(): void {
    this.pathsCache.clear();
    this.listCache = undefined;
  }

  /** Components in the session's namespace (cached for a minute). */
  async list(): Promise<SourcedComponent[]> {
    const namespace = this.authProvider.getContextInfo()?.namespace;
    if (!namespace) return [];
    const key = `${this.authProvider.getSession()?.controlPlaneUrl}|${namespace}`;
    if (this.listCache && this.listCache.key === key && Date.now() - this.listCache.at < 60_000) {
      return this.listCache.value;
    }
    const value = this.load(namespace).catch((err) => {
      log.info(`Could not list component sources: ${err instanceof Error ? err.message : err}`);
      this.listCache = undefined;
      return [];
    });
    this.listCache = { key, at: Date.now(), value };
    return value;
  }

  async get(namespace: string, component: string): Promise<SourcedComponent | undefined> {
    const client = await this.apiClientManager.getClient();
    if (!client) return undefined;
    const item = (await fetchResource(client, 'component', namespace, component)) as ComponentItem;
    return this.toSourced(namespace, item);
  }

  private async load(namespace: string): Promise<SourcedComponent[]> {
    const client = await this.apiClientManager.getClient();
    if (!client) return [];
    const { data, error } = await client.GET('/api/v1/namespaces/{namespaceName}/components', {
      params: { path: { namespaceName: namespace } },
    });
    if (error) throw new Error(JSON.stringify(error));
    const items = (data?.items ?? []) as ComponentItem[];
    const sourced = await Promise.all(items.map((item) => this.toSourced(namespace, item)));
    return sourced.filter((c): c is SourcedComponent => !!c);
  }

  private async toSourced(namespace: string, item: ComponentItem): Promise<SourcedComponent | undefined> {
    const name = item.metadata?.name;
    if (!name) return undefined;
    const workflow = workflowRef(item.spec);
    const parameters = item.spec?.workflow?.parameters ?? {};
    const paths = workflow ? await this.paths(namespace, workflow) : {};
    return {
      namespace,
      project: item.spec?.owner?.projectName ?? '',
      name,
      workflow,
      paths,
      parameters,
      autoBuild: item.spec?.autoBuild === true,
      ...componentSource(parameters, paths),
    };
  }

  /** Repository paths of a workflow, fetched once per session. */
  paths(namespace: string, workflow: WorkflowRef): Promise<RepositoryPaths> {
    const key = workflow.kind === 'ClusterWorkflow' ? `cluster/${workflow.name}` : `${namespace}/${workflow.name}`;
    let cached = this.pathsCache.get(key);
    if (!cached) {
      cached = (async () => {
        const client = await this.apiClientManager.getClient();
        if (!client) return {};
        const nodeType = workflow.kind === 'ClusterWorkflow' ? 'cluster-workflow' : 'workflow';
        const resource = await fetchResource(client, nodeType, namespace, workflow.name);
        return repositoryPaths(workflowParameterSchema(resource));
      })().catch((err) => {
        log.info(`Could not read workflow ${key}: ${err instanceof Error ? err.message : err}`);
        this.pathsCache.delete(key);
        return {};
      });
      this.pathsCache.set(key, cached);
    }
    return cached;
  }
}

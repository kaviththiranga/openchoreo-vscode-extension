// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { OccConfigAuthProvider } from '../auth/authProvider';
import type { ApiClientManager } from '../api/apiClient';
import type { CapabilityService } from '../services/capabilityService';
import type { ResourceNodeData, ResourceNodeType } from './types';
import { toTreeItem } from './shared';

type Client = NonNullable<
  Awaited<ReturnType<ApiClientManager['getClient']>>
>;

export class ResourceExplorerProvider
  implements vscode.TreeDataProvider<ResourceNodeData>
{
  private onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    ResourceNodeData | undefined | void
  >();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(
    private readonly authProvider: OccConfigAuthProvider,
    private readonly apiClientManager: ApiClientManager,
    private readonly capabilityService: CapabilityService,
  ) {
    authProvider.onDidChangeSession(() => this.refresh());
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: ResourceNodeData): vscode.TreeItem {
    return toTreeItem(element);
  }

  async getChildren(
    element?: ResourceNodeData,
  ): Promise<ResourceNodeData[]> {
    if (!element) {
      return this.getRootNodes();
    }
    if (element.childrenMode === 'preloaded') {
      return element.children ?? [];
    }
    if (element.childrenMode === 'lazy') {
      return this.fetchLazyChildren(element);
    }
    return [];
  }

  private async getRootNodes(): Promise<ResourceNodeData[]> {
    const session = this.authProvider.getSession();
    if (!session) {
      return [
        {
          label: 'Not connected. Run "occ login" to authenticate.',
          type: 'no-connection',
          contextValue: 'no-connection',
          childrenMode: 'none',
        },
      ];
    }

    const contextInfo = this.authProvider.getContextInfo();
    if (!contextInfo?.namespace) {
      return [
        {
          label: 'No namespace selected. Click $(globe) to select one.',
          type: 'no-connection',
          contextValue: 'no-connection',
          childrenMode: 'none',
        },
      ];
    }

    try {
      const client = await this.apiClientManager.getClient();
      if (!client) {
        return [
          {
            label: 'Session expired. Run "occ login" to re-authenticate.',
            type: 'no-connection',
            contextValue: 'no-connection',
            childrenMode: 'none',
          },
        ];
      }

      const ns = contextInfo.namespace;

      // Ensure RBAC capabilities are loaded for this namespace
      await this.capabilityService.ensureLoaded(ns);

      const { data, error } = await client.GET(
        '/api/v1/namespaces/{namespaceName}/projects',
        { params: { path: { namespaceName: ns } } },
      );

      if (error) {
        throw new Error('Failed to fetch projects');
      }

      const projectItems = data?.items ?? [];
      if (projectItems.length === 0) {
        return [
          {
            label: 'No projects',
            type: 'empty',
            contextValue: 'empty',
            childrenMode: 'none',
          },
        ];
      }

      return projectItems.map((p) => {
        const isDeleting = !!(p as { metadata?: { deletionTimestamp?: string } }).metadata?.deletionTimestamp;
        return {
          label: (p.metadata?.name as string),
          type: 'project' as const,
          contextValue: isDeleting ? 'project' : this.resolveContextValue('project'),
          description: isDeleting ? '(deleting)' : undefined,
          namespace: ns,
          project: p.metadata?.name as string,
          resourceName: p.metadata?.name as string,
          childrenMode: 'lazy' as const,
          lazyChildrenKey: 'project-children',
        };
      });
    } catch (error) {
      return [
        {
          label: `Error: ${error instanceof Error ? error.message : 'Failed to fetch resources'}`,
          type: 'no-connection',
          contextValue: 'no-connection',
          childrenMode: 'none',
        },
      ];
    }
  }

  private async fetchLazyChildren(
    element: ResourceNodeData,
  ): Promise<ResourceNodeData[]> {
    try {
      const client = await this.apiClientManager.getClient();
      if (!client) {
        return [];
      }

      switch (element.lazyChildrenKey) {
        case 'project-children':
          return this.fetchProjectChildren(client, element);
        case 'component-children':
          return this.buildComponentCategories(element);
        case 'workflow-runs':
          return this.fetchWorkflowRuns(client, element);
        case 'component-releases':
          return this.fetchComponentReleases(client, element);
        case 'release-bindings':
          return this.fetchReleaseBindings(client, element);
        case 'workloads':
          return this.fetchWorkloads(client, element);
        default:
          return [];
      }
    } catch {
      return [
        {
          label: 'Failed to load',
          type: 'empty',
          contextValue: 'empty',
          childrenMode: 'none',
        },
      ];
    }
  }

  private static readonly EDITABLE_TYPES: ReadonlySet<ResourceNodeType> =
    new Set(['project', 'component', 'deployment-pipeline', 'workload', 'release-binding']);

  /** Types that support creating child resources via inline "+" button. */
  private static readonly CREATABLE_TYPES: ReadonlySet<ResourceNodeType> =
    new Set(['project']);

  private resolveContextValue(type: ResourceNodeType): string {
    let value: string = type;
    if (ResourceExplorerProvider.EDITABLE_TYPES.has(type)) {
      value += '_editable';
    }
    if (this.capabilityService.canDelete(type)) {
      value += '_deletable';
    }
    if (ResourceExplorerProvider.CREATABLE_TYPES.has(type)) {
      value += '_creatable';
    }
    return value;
  }

  private async fetchProjectChildren(
    client: Client,
    element: ResourceNodeData,
  ): Promise<ResourceNodeData[]> {
    const ns = element.namespace!;
    const proj = element.project!;
    const children: ResourceNodeData[] = [];

    // Fetch deployment pipelines for this project
    const { data: pipelineData } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/deploymentpipelines',
      { params: { path: { namespaceName: ns }, query: { labelSelector: `openchoreo.dev/project=${proj}` } } },
    );

    const pipelines = pipelineData?.items ?? [];
    for (const pipeline of pipelines) {
      const pipelineName = pipeline.metadata?.name as string;
      const isDeleting = !!(pipeline as { metadata?: { deletionTimestamp?: string } }).metadata?.deletionTimestamp;
      children.push({
        label: pipelineName ?? 'deployment-pipeline',
        type: 'deployment-pipeline',
        contextValue: isDeleting ? 'deployment-pipeline' : this.resolveContextValue('deployment-pipeline'),
        description: isDeleting ? '(deleting)' : undefined,
        namespace: ns,
        project: proj,
        resourceName: pipelineName ?? 'deployment-pipeline',
        childrenMode: 'none',
      });
    }

    // Fetch components for this project
    const { data: componentsData } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/components',
      { params: { path: { namespaceName: ns }, query: { project: proj } } },
    );

    const componentItems = componentsData?.items ?? [];
    for (const comp of componentItems) {
      const compName = comp.metadata?.name as string;
      const isDeleting = !!(comp as { metadata?: { deletionTimestamp?: string } }).metadata?.deletionTimestamp;
      children.push({
        label: compName,
        type: 'component',
        contextValue: isDeleting ? 'component' : this.resolveContextValue('component'),
        description: isDeleting ? '(deleting)' : undefined,
        namespace: ns,
        project: proj,
        component: compName,
        resourceName: compName,
        childrenMode: 'lazy',
        lazyChildrenKey: 'component-children',
      });
    }

    if (children.length === 0) {
      return [
        {
          label: 'No resources',
          type: 'empty',
          contextValue: 'empty',
          childrenMode: 'none',
        },
      ];
    }

    return children;
  }

  private buildComponentCategories(
    element: ResourceNodeData,
  ): ResourceNodeData[] {
    const base = {
      namespace: element.namespace,
      project: element.project,
      component: element.component,
    };

    return [
      {
        label: 'Workflow Runs',
        type: 'component-category',
        icon: 'workflow-run',
        contextValue: 'component-category',
        ...base,
        childrenMode: 'lazy',
        lazyChildrenKey: 'workflow-runs',
      },
      {
        label: 'Releases',
        type: 'component-category',
        icon: 'component-release',
        contextValue: 'component-category',
        ...base,
        childrenMode: 'lazy',
        lazyChildrenKey: 'component-releases',
      },
      {
        label: 'Release Bindings',
        icon: 'release-binding',
        type: 'component-category',
        contextValue: 'component-category',
        ...base,
        childrenMode: 'lazy',
        lazyChildrenKey: 'release-bindings',
      },
      {
        label: 'Workloads',
        type: 'component-category',
        icon: 'workload',
        contextValue: 'component-category',
        ...base,
        childrenMode: 'lazy',
        lazyChildrenKey: 'workloads',
      },
    ];
  }

  private async fetchWorkflowRuns(
    client: Client,
    element: ResourceNodeData,
  ): Promise<ResourceNodeData[]> {
    const { data, error } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/workflowruns',
      {
        params: {
          path: { namespaceName: element.namespace! },
          query: {
            labelSelector: `openchoreo.dev/project=${element.project!},openchoreo.dev/component=${element.component!}`,
          },
        },
      },
    );

    if (error) {
      return [];
    }

    const items = data?.items ?? [];
    if (items.length === 0) {
      return [{ label: 'No workflow runs', type: 'empty', contextValue: 'empty', childrenMode: 'none' }];
    }

    return items.map((item) => {
      const isDeleting = !!(item as { metadata?: { deletionTimestamp?: string } }).metadata?.deletionTimestamp;
      const phase = (item as { status?: { phase?: string } }).status?.phase;
      return {
        label: (item.metadata?.name as string) ?? 'unknown',
        type: 'workflow-run' as const,
        contextValue: 'workflow-run',
        description: isDeleting ? (phase ? `(deleting) ${phase}` : '(deleting)') : phase,
        namespace: element.namespace,
        project: element.project,
        component: element.component,
        resourceName: item.metadata?.name as string,
        childrenMode: 'none' as const,
      };
    });
  }

  private async fetchComponentReleases(
    client: Client,
    element: ResourceNodeData,
  ): Promise<ResourceNodeData[]> {
    const { data, error } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/componentreleases',
      {
        params: {
          path: { namespaceName: element.namespace! },
          query: {
            component: element.component!,
          },
        },
      },
    );

    if (error) {
      return [];
    }

    const items = data?.items ?? [];
    if (items.length === 0) {
      return [{ label: 'No releases', type: 'empty', contextValue: 'empty', childrenMode: 'none' }];
    }

    return items.map((item) => {
      const isDeleting = !!(item as { metadata?: { deletionTimestamp?: string } }).metadata?.deletionTimestamp;
      return {
        label: (item.metadata?.name as string) ?? 'unknown',
        type: 'component-release' as const,
        contextValue: 'component-release',
        description: isDeleting ? '(deleting)' : undefined,
        namespace: element.namespace,
        project: element.project,
        component: element.component,
        resourceName: item.metadata?.name as string,
        childrenMode: 'none' as const,
      };
    });
  }

  private async fetchReleaseBindings(
    client: Client,
    element: ResourceNodeData,
  ): Promise<ResourceNodeData[]> {
    const { data, error } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/releasebindings',
      {
        params: {
          path: { namespaceName: element.namespace! },
          query: {
            component: element.component!,
          },
        },
      },
    );

    if (error) {
      return [];
    }

    const items = data?.items ?? [];
    if (items.length === 0) {
      return [{ label: 'No release bindings', type: 'empty', contextValue: 'empty', childrenMode: 'none' }];
    }

    return items.map((item) => {
      const isDeleting = !!(item as { metadata?: { deletionTimestamp?: string } }).metadata?.deletionTimestamp;
      return {
        label: (item.metadata?.name as string) ?? 'unknown',
        type: 'release-binding' as const,
        contextValue: isDeleting ? 'release-binding' : this.resolveContextValue('release-binding'),
        description: isDeleting ? '(deleting)' : undefined,
        namespace: element.namespace,
        project: element.project,
        component: element.component,
        resourceName: item.metadata?.name as string,
        childrenMode: 'none' as const,
      };
    });
  }

  private async fetchWorkloads(
    client: Client,
    element: ResourceNodeData,
  ): Promise<ResourceNodeData[]> {
    const { data, error } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/workloads',
      {
        params: {
          path: { namespaceName: element.namespace! },
          query: {
            component: element.component!,
          },
        },
      },
    );

    if (error) {
      return [];
    }

    const items = data?.items ?? [];
    if (items.length === 0) {
      return [{ label: 'No workloads', type: 'empty', contextValue: 'empty', childrenMode: 'none' }];
    }

    return items.map((item) => {
      const isDeleting = !!(item as { metadata?: { deletionTimestamp?: string } }).metadata?.deletionTimestamp;
      return {
        label: (item.metadata?.name as string) ?? 'unknown',
        type: 'workload' as const,
        contextValue: isDeleting ? 'workload' : this.resolveContextValue('workload'),
        description: isDeleting ? '(deleting)' : undefined,
        namespace: element.namespace,
        project: element.project,
        component: element.component,
        resourceName: item.metadata?.name as string,
        childrenMode: 'none' as const,
      };
    });
  }
}

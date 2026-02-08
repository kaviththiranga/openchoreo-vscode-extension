// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { OccConfigAuthProvider } from '../auth/authProvider';
import type { ApiClientManager } from '../api/apiClient';
import type { ResourceNodeData } from './types';
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
    const contextInfo = this.authProvider.getContextInfo();
    if (!contextInfo) {
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
      return [
        {
          label: 'No context configured',
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

      const { data, error } = await client.GET(
        '/namespaces/{namespaceName}/projects',
        { params: { path: { namespaceName: contextInfo.namespace } } },
      );

      if (error) {
        throw new Error('Failed to fetch projects');
      }

      const projectItems = data?.data?.items ?? [];

      const namespaceNode: ResourceNodeData = {
        label: contextInfo.namespace,
        type: 'namespace',
        contextValue: 'namespace',
        namespace: contextInfo.namespace,
        childrenMode: 'preloaded',
        children:
          projectItems.length === 0
            ? [
                {
                  label: 'No projects',
                  type: 'empty',
                  contextValue: 'empty',
                  childrenMode: 'none',
                },
              ]
            : projectItems.map((p) => ({
                label: p.name as string,
                type: 'project' as const,
                contextValue: 'project',
                namespace: contextInfo.namespace,
                project: p.name as string,
                childrenMode: 'lazy' as const,
                lazyChildrenKey: 'project-children',
              })),
      };

      return [namespaceNode];
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
        case 'component-traits':
          return this.fetchComponentTraits(client, element);
        case 'bindings':
          return this.fetchBindings(client, element);
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

  private async fetchProjectChildren(
    client: Client,
    element: ResourceNodeData,
  ): Promise<ResourceNodeData[]> {
    const ns = element.namespace!;
    const proj = element.project!;
    const children: ResourceNodeData[] = [];

    // Fetch deployment pipeline
    const { data: pipelineData } = await client.GET(
      '/namespaces/{namespaceName}/projects/{projectName}/deployment-pipeline',
      { params: { path: { namespaceName: ns, projectName: proj } } },
    );

    if (pipelineData?.data) {
      const pipeline = pipelineData.data as { name?: string };
      children.push({
        label: pipeline.name ?? 'deployment-pipeline',
        type: 'deployment-pipeline',
        contextValue: 'deployment-pipeline',
        namespace: ns,
        project: proj,
        resourceName: pipeline.name ?? 'deployment-pipeline',
        childrenMode: 'none',
      });
    }

    // Fetch components
    const { data: componentsData } = await client.GET(
      '/namespaces/{namespaceName}/projects/{projectName}/components',
      { params: { path: { namespaceName: ns, projectName: proj } } },
    );

    const componentItems = componentsData?.data?.items ?? [];
    for (const comp of componentItems) {
      const compName = comp.name as string;
      children.push({
        label: compName,
        type: 'component',
        contextValue: 'component',
        namespace: ns,
        project: proj,
        component: compName,
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
        contextValue: 'component-category',
        ...base,
        childrenMode: 'lazy',
        lazyChildrenKey: 'workflow-runs',
      },
      {
        label: 'Releases',
        type: 'component-category',
        contextValue: 'component-category',
        ...base,
        childrenMode: 'lazy',
        lazyChildrenKey: 'component-releases',
      },
      {
        label: 'Release Bindings',
        type: 'component-category',
        contextValue: 'component-category',
        ...base,
        childrenMode: 'lazy',
        lazyChildrenKey: 'release-bindings',
      },
      {
        label: 'Traits',
        type: 'component-category',
        contextValue: 'component-category',
        ...base,
        childrenMode: 'lazy',
        lazyChildrenKey: 'component-traits',
      },
      {
        label: 'Bindings',
        type: 'component-category',
        contextValue: 'component-category',
        ...base,
        childrenMode: 'lazy',
        lazyChildrenKey: 'bindings',
      },
      {
        label: 'Workloads',
        type: 'component-category',
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
      '/namespaces/{namespaceName}/projects/{projectName}/components/{componentName}/workflow-runs',
      {
        params: {
          path: {
            namespaceName: element.namespace!,
            projectName: element.project!,
            componentName: element.component!,
          },
        },
      },
    );

    if (error) {
      return [];
    }

    const items = (data?.data as { items?: Array<{ name?: string; status?: string }> })?.items ?? [];
    if (items.length === 0) {
      return [{ label: 'No workflow runs', type: 'empty', contextValue: 'empty', childrenMode: 'none' }];
    }

    return items.map((item) => ({
      label: (item.name as string) ?? 'unknown',
      type: 'workflow-run' as const,
      contextValue: 'workflow-run',
      description: item.status as string | undefined,
      namespace: element.namespace,
      project: element.project,
      component: element.component,
      resourceName: item.name as string,
      childrenMode: 'none' as const,
    }));
  }

  private async fetchComponentReleases(
    client: Client,
    element: ResourceNodeData,
  ): Promise<ResourceNodeData[]> {
    const { data, error } = await client.GET(
      '/namespaces/{namespaceName}/projects/{projectName}/components/{componentName}/component-releases',
      {
        params: {
          path: {
            namespaceName: element.namespace!,
            projectName: element.project!,
            componentName: element.component!,
          },
        },
      },
    );

    if (error) {
      return [];
    }

    const items = (data?.data as { items?: Array<{ name?: string }> })?.items ?? [];
    if (items.length === 0) {
      return [{ label: 'No releases', type: 'empty', contextValue: 'empty', childrenMode: 'none' }];
    }

    return items.map((item) => ({
      label: (item.name as string) ?? 'unknown',
      type: 'component-release' as const,
      contextValue: 'component-release',
      namespace: element.namespace,
      project: element.project,
      component: element.component,
      resourceName: item.name as string,
      childrenMode: 'none' as const,
    }));
  }

  private async fetchReleaseBindings(
    client: Client,
    element: ResourceNodeData,
  ): Promise<ResourceNodeData[]> {
    const { data, error } = await client.GET(
      '/namespaces/{namespaceName}/projects/{projectName}/components/{componentName}/release-bindings',
      {
        params: {
          path: {
            namespaceName: element.namespace!,
            projectName: element.project!,
            componentName: element.component!,
          },
        },
      },
    );

    if (error) {
      return [];
    }

    const items = (data?.data as { items?: Array<{ name?: string }> })?.items ?? [];
    if (items.length === 0) {
      return [{ label: 'No release bindings', type: 'empty', contextValue: 'empty', childrenMode: 'none' }];
    }

    return items.map((item) => ({
      label: (item.name as string) ?? 'unknown',
      type: 'release-binding' as const,
      contextValue: 'release-binding',
      namespace: element.namespace,
      project: element.project,
      component: element.component,
      resourceName: item.name as string,
      childrenMode: 'none' as const,
    }));
  }

  private async fetchComponentTraits(
    client: Client,
    element: ResourceNodeData,
  ): Promise<ResourceNodeData[]> {
    const { data, error } = await client.GET(
      '/namespaces/{namespaceName}/projects/{projectName}/components/{componentName}/traits',
      {
        params: {
          path: {
            namespaceName: element.namespace!,
            projectName: element.project!,
            componentName: element.component!,
          },
        },
      },
    );

    if (error) {
      return [];
    }

    const items = (data?.data as { items?: Array<{ name?: string }> })?.items ?? [];
    if (items.length === 0) {
      return [{ label: 'No traits', type: 'empty', contextValue: 'empty', childrenMode: 'none' }];
    }

    return items.map((item) => ({
      label: (item.name as string) ?? 'unknown',
      type: 'component-trait' as const,
      contextValue: 'component-trait',
      namespace: element.namespace,
      project: element.project,
      component: element.component,
      resourceName: item.name as string,
      childrenMode: 'none' as const,
    }));
  }

  private async fetchBindings(
    client: Client,
    element: ResourceNodeData,
  ): Promise<ResourceNodeData[]> {
    const { data, error } = await client.GET(
      '/namespaces/{namespaceName}/projects/{projectName}/components/{componentName}/bindings',
      {
        params: {
          path: {
            namespaceName: element.namespace!,
            projectName: element.project!,
            componentName: element.component!,
          },
        },
      },
    );

    if (error) {
      return [];
    }

    const items = (data?.data as { items?: Array<{ name?: string; status?: string }> })?.items ?? [];
    if (items.length === 0) {
      return [{ label: 'No bindings', type: 'empty', contextValue: 'empty', childrenMode: 'none' }];
    }

    return items.map((item) => ({
      label: (item.name as string) ?? 'unknown',
      type: 'binding' as const,
      contextValue: 'binding',
      description: item.status as string | undefined,
      namespace: element.namespace,
      project: element.project,
      component: element.component,
      resourceName: item.name as string,
      childrenMode: 'none' as const,
    }));
  }

  private async fetchWorkloads(
    client: Client,
    element: ResourceNodeData,
  ): Promise<ResourceNodeData[]> {
    const { data, error } = await client.GET(
      '/namespaces/{namespaceName}/projects/{projectName}/components/{componentName}/workloads',
      {
        params: {
          path: {
            namespaceName: element.namespace!,
            projectName: element.project!,
            componentName: element.component!,
          },
        },
      },
    );

    if (error) {
      return [];
    }

    // Workloads endpoint returns a singular response, not a list
    const workload = data?.data as { name?: string } | undefined;
    if (!workload?.name) {
      return [{ label: 'No workloads', type: 'empty', contextValue: 'empty', childrenMode: 'none' }];
    }

    return [
      {
        label: workload.name,
        type: 'workload',
        contextValue: 'workload',
        namespace: element.namespace,
        project: element.project,
        component: element.component,
        resourceName: workload.name,
        childrenMode: 'none',
      },
    ];
  }
}

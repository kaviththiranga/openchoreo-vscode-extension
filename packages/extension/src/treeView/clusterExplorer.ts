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

/**
 * Tree view provider for cluster-scoped resources.
 * No namespace context needed — all resources are cluster-wide.
 */
export class ClusterExplorerProvider
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

  private getRootNodes(): ResourceNodeData[] {
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
        label: 'Component Types',
        type: 'infra-category',
        contextValue: 'infra-category',
        childrenMode: 'lazy',
        lazyChildrenKey: 'cluster-component-types',
      },
      {
        label: 'Workflows',
        type: 'infra-category',
        contextValue: 'infra-category',
        childrenMode: 'lazy',
        lazyChildrenKey: 'cluster-workflows',
      },
      {
        label: 'Traits',
        type: 'infra-category',
        contextValue: 'infra-category',
        childrenMode: 'lazy',
        lazyChildrenKey: 'cluster-traits',
      },
      {
        label: 'Data Planes',
        type: 'infra-category',
        contextValue: 'infra-category',
        childrenMode: 'lazy',
        lazyChildrenKey: 'cluster-data-planes',
      },
      {
        label: 'Workflow Planes',
        type: 'infra-category',
        contextValue: 'infra-category',
        childrenMode: 'lazy',
        lazyChildrenKey: 'cluster-workflow-planes',
      },
      {
        label: 'Observability Planes',
        type: 'infra-category',
        contextValue: 'infra-category',
        childrenMode: 'lazy',
        lazyChildrenKey: 'cluster-observability-planes',
      },
      {
        label: 'RBAC',
        type: 'infra-category',
        contextValue: 'infra-category',
        childrenMode: 'preloaded',
        children: [
          {
            label: 'Roles',
            type: 'infra-category',
            contextValue: 'infra-category',
            childrenMode: 'lazy',
            lazyChildrenKey: 'cluster-roles',
          },
          {
            label: 'Role Bindings',
            type: 'infra-category',
            contextValue: 'infra-category',
            childrenMode: 'lazy',
            lazyChildrenKey: 'cluster-role-bindings',
          },
        ],
      },
    ];
  }

  private static readonly EDITABLE_TYPES: ReadonlySet<ResourceNodeType> =
    new Set([
      'cluster-component-type',
      'cluster-workflow',
      'cluster-trait',
      'cluster-data-plane',
      'cluster-workflow-plane',
      'cluster-observability-plane',
      'cluster-role',
      'cluster-role-binding',
    ]);

  private resolveContextValue(type: ResourceNodeType): string {
    let value: string = type;
    if (ClusterExplorerProvider.EDITABLE_TYPES.has(type)) {
      value += '_editable';
    }
    if (this.capabilityService.canDelete(type)) {
      value += '_deletable';
    }
    return value;
  }

  private async fetchLazyChildren(
    element: ResourceNodeData,
  ): Promise<ResourceNodeData[]> {
    try {
      switch (element.lazyChildrenKey) {
        case 'cluster-component-types':
          return this.fetchClusterList('/api/v1/clustercomponenttypes', 'cluster-component-type');
        case 'cluster-workflows':
          return this.fetchClusterList('/api/v1/clusterworkflows', 'cluster-workflow');
        case 'cluster-traits':
          return this.fetchClusterList('/api/v1/clustertraits', 'cluster-trait');
        case 'cluster-data-planes':
          return this.fetchClusterList('/api/v1/clusterdataplanes', 'cluster-data-plane');
        case 'cluster-workflow-planes':
          return this.fetchClusterList('/api/v1/clusterworkflowplanes', 'cluster-workflow-plane');
        case 'cluster-observability-planes':
          return this.fetchClusterList('/api/v1/clusterobservabilityplanes', 'cluster-observability-plane');
        case 'cluster-roles':
          return this.fetchClusterList('/api/v1/clusterauthzroles', 'cluster-role');
        case 'cluster-role-bindings':
          return this.fetchClusterList('/api/v1/clusterauthzrolebindings', 'cluster-role-binding');
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

  /** Generic fetch for cluster-scoped list endpoints. */
  private async fetchClusterList(
    path: string,
    nodeType: ResourceNodeType,
  ): Promise<ResourceNodeData[]> {
    const client = await this.requireClient();
    const { data, error } = await client.GET(path as never);

    if (error) {
      return [];
    }

    const items =
      (data as { items?: Array<{ metadata?: { name?: string } }> })?.items ?? [];
    if (items.length === 0) {
      return [
        {
          label: `No ${nodeType.replace('cluster-', '')}s`,
          type: 'empty',
          contextValue: 'empty',
          childrenMode: 'none',
        },
      ];
    }

    return items.map((item) => ({
      label: (item.metadata?.name as string) ?? 'unknown',
      type: nodeType,
      contextValue: this.resolveContextValue(nodeType),
      resourceName: item.metadata?.name as string,
      childrenMode: 'none' as const,
    }));
  }

  private async requireClient(): Promise<Client> {
    const client = await this.apiClientManager.getClient();
    if (!client) {
      throw new Error('Not authenticated');
    }
    return client;
  }
}

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

    return [
      {
        label: 'Cluster Component Types',
        type: 'infra-category',
        icon: 'cluster-component-type',
        contextValue: 'infra-category_creatable',
        childrenMode: 'lazy',
        lazyChildrenKey: 'cluster-component-types',
      },
      {
        label: 'Cluster Resource Types',
        type: 'infra-category',
        icon: 'cluster-resource-type',
        contextValue: 'infra-category_creatable',
        childrenMode: 'lazy',
        lazyChildrenKey: 'cluster-resource-types',
      },
      {
        label: 'Cluster Workflows',
        type: 'infra-category',
        icon: 'cluster-workflow',
        contextValue: 'infra-category_creatable',
        childrenMode: 'lazy',
        lazyChildrenKey: 'cluster-workflows',
      },
      {
        label: 'Cluster Traits',
        type: 'infra-category',
        icon: 'cluster-trait',
        contextValue: 'infra-category_creatable',
        childrenMode: 'lazy',
        lazyChildrenKey: 'cluster-traits',
      },
      {
        label: 'Cluster Data Planes',
        type: 'infra-category',
        icon: 'cluster-data-plane',
        contextValue: 'infra-category_creatable',
        childrenMode: 'lazy',
        lazyChildrenKey: 'cluster-data-planes',
      },
      {
        label: 'Cluster Workflow Planes',
        type: 'infra-category',
        icon: 'cluster-workflow-plane',
        contextValue: 'infra-category_creatable',
        childrenMode: 'lazy',
        lazyChildrenKey: 'cluster-workflow-planes',
      },
      {
        label: 'Cluster Observability Planes',
        type: 'infra-category',
        icon: 'cluster-observability-plane',
        contextValue: 'infra-category',
        childrenMode: 'lazy',
        lazyChildrenKey: 'cluster-observability-planes',
      },
      {
        label: 'RBAC',
        type: 'infra-category',
        icon: 'cluster-role',
        contextValue: 'infra-category',
        childrenMode: 'preloaded',
        children: [
          {
            label: 'Cluster Roles',
            type: 'infra-category',
            icon: 'cluster-role',
            contextValue: 'infra-category_creatable',
            childrenMode: 'lazy',
            lazyChildrenKey: 'cluster-roles',
          },
          {
            label: 'Cluster Role Bindings',
            type: 'infra-category',
            icon: 'cluster-role-binding',
            contextValue: 'infra-category_creatable',
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
      'cluster-resource-type',
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
      await this.capabilityService.ensureLoaded();

      switch (element.lazyChildrenKey) {
        case 'cluster-component-types':
          return this.fetchClusterList('/api/v1/clustercomponenttypes', 'cluster-component-type');
        case 'cluster-resource-types':
          return this.fetchClusterList('/api/v1/clusterresourcetypes', 'cluster-resource-type');
        case 'cluster-workflows':
          return this.fetchClusterWorkflows();
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
        case 'cluster-workflow-runs':
          return this.fetchClusterWorkflowRuns(element.resourceName!);
        case 'workflow-run-steps':
          return this.fetchWorkflowRunSteps(element.namespace!, element.resourceName!);
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
      (data as { items?: Array<{ metadata?: { name?: string; deletionTimestamp?: string } }> })?.items ?? [];
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

    return items.map((item) => {
      const isDeleting = !!item.metadata?.deletionTimestamp;
      return {
        label: (item.metadata?.name as string) ?? 'unknown',
        type: nodeType,
        contextValue: isDeleting ? nodeType : this.resolveContextValue(nodeType),
        description: isDeleting ? '(deleting)' : undefined,
        resourceName: item.metadata?.name as string,
        childrenMode: 'none' as const,
      };
    });
  }

  /** Fetch cluster workflows — expandable to show runs. */
  private async fetchClusterWorkflows(): Promise<ResourceNodeData[]> {
    const client = await this.requireClient();
    const { data, error } = await client.GET('/api/v1/clusterworkflows' as never);
    if (error) return [];

    const items = (data as { items?: Array<{ metadata?: { name?: string; deletionTimestamp?: string } }> })?.items ?? [];
    if (items.length === 0) {
      return [{ label: 'No cluster workflows', type: 'empty', contextValue: 'empty', childrenMode: 'none' }];
    }

    return items.map((item) => {
      const isDeleting = !!item.metadata?.deletionTimestamp;
      return {
        label: (item.metadata?.name as string) ?? 'unknown',
        type: 'cluster-workflow' as const,
        contextValue: isDeleting ? 'cluster-workflow' : this.resolveContextValue('cluster-workflow'),
        description: isDeleting ? '(deleting)' : undefined,
        resourceName: item.metadata?.name as string,
        childrenMode: 'lazy' as const,
        lazyChildrenKey: 'cluster-workflow-runs',
      };
    });
  }

  /** Fetch workflow runs across all namespaces that reference a cluster workflow. */
  private async fetchClusterWorkflowRuns(workflowName: string): Promise<ResourceNodeData[]> {
    const client = await this.requireClient();
    // Fetch runs from the current namespace (cross-namespace not supported by API)
    const ns = this.authProvider.getContextInfo()?.namespace;
    if (!ns) return [{ label: 'Select a namespace to see runs', type: 'empty', contextValue: 'empty', childrenMode: 'none' }];

    const { data, error } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/workflowruns',
      { params: { path: { namespaceName: ns } } },
    );
    if (error) return [];

    const allRuns = (data as { items?: Array<{ metadata?: { name?: string; deletionTimestamp?: string }; spec?: { workflow?: { name?: string; kind?: string } }; status?: { phase?: string } }> })?.items ?? [];
    const runs = allRuns.filter(r => r.spec?.workflow?.name === workflowName && (r.spec?.workflow?.kind === 'ClusterWorkflow' || !r.spec?.workflow?.kind));

    if (runs.length === 0) {
      return [{ label: 'No workflow runs', type: 'empty', contextValue: 'empty', childrenMode: 'none' }];
    }

    return runs.map((item) => {
      const isDeleting = !!item.metadata?.deletionTimestamp;
      const phase = item.status?.phase;
      return {
        label: (item.metadata?.name as string) ?? 'unknown',
        type: 'workflow-run' as const,
        contextValue: 'workflow-run',
        description: isDeleting ? (phase ? `(deleting) ${phase}` : '(deleting)') : phase,
        statusPhase: phase,
        namespace: ns,
        resourceName: item.metadata?.name as string,
        childrenMode: 'lazy' as const,
        lazyChildrenKey: 'workflow-run-steps',
      };
    });
  }

  /** Fetch workflow run steps. */
  private async fetchWorkflowRunSteps(ns: string, runName: string): Promise<ResourceNodeData[]> {
    const client = await this.requireClient();
    const { data, error } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/workflowruns/{runName}/status' as never,
      { params: { path: { namespaceName: ns, runName } } } as never,
    );
    if (error) return [];

    const status = data as { steps?: Array<{ name: string; phase: string; startedAt?: string; finishedAt?: string }> } | null;
    if (!status?.steps?.length) {
      return [{ label: 'No steps available', type: 'empty', contextValue: 'empty', childrenMode: 'none' }];
    }

    return status.steps.map((step) => {
      let desc = step.phase;
      if (step.startedAt && step.finishedAt) {
        const dur = new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime();
        const secs = Math.round(dur / 1000);
        desc = secs >= 60 ? `${step.phase} (${Math.floor(secs / 60)}m${secs % 60}s)` : `${step.phase} (${secs}s)`;
      }
      return {
        label: step.name,
        type: 'workflow-run-step' as const,
        contextValue: 'workflow-run-step',
        description: desc,
        statusPhase: step.phase,
        namespace: ns,
        resourceName: runName,
        extra: { taskName: step.name },
        childrenMode: 'none' as const,
      };
    });
  }

  private async requireClient(): Promise<Client> {
    const client = await this.apiClientManager.getClient();
    if (!client) {
      throw new Error('Not authenticated');
    }
    return client;
  }
}

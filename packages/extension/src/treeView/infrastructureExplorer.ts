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

type LegacyClient = NonNullable<
  Awaited<ReturnType<ApiClientManager['getLegacyClient']>>
>;

export class InfrastructureExplorerProvider
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

    const ns = contextInfo.namespace;

    return [
      {
        label: 'Environments',
        type: 'infra-category',
        contextValue: 'infra-category',
        namespace: ns,
        childrenMode: 'lazy',
        lazyChildrenKey: 'environments',
      },
      {
        label: 'Data Planes',
        type: 'infra-category',
        contextValue: 'infra-category',
        namespace: ns,
        childrenMode: 'lazy',
        lazyChildrenKey: 'data-planes',
      },
      {
        label: 'Build Planes',
        type: 'infra-category',
        contextValue: 'infra-category',
        namespace: ns,
        childrenMode: 'lazy',
        lazyChildrenKey: 'build-planes',
      },
      {
        label: 'Observability Planes',
        type: 'infra-category',
        contextValue: 'infra-category',
        namespace: ns,
        childrenMode: 'lazy',
        lazyChildrenKey: 'observability-planes',
      },
      {
        label: 'Component Types',
        type: 'infra-category',
        contextValue: 'infra-category',
        namespace: ns,
        childrenMode: 'lazy',
        lazyChildrenKey: 'component-types',
      },
      {
        label: 'Workflows',
        type: 'infra-category',
        contextValue: 'infra-category',
        namespace: ns,
        childrenMode: 'lazy',
        lazyChildrenKey: 'workflows',
      },
      {
        label: 'Component Workflows',
        type: 'infra-category',
        contextValue: 'infra-category',
        namespace: ns,
        childrenMode: 'lazy',
        lazyChildrenKey: 'component-workflows',
      },
      {
        label: 'Traits Catalog',
        type: 'infra-category',
        contextValue: 'infra-category',
        namespace: ns,
        childrenMode: 'lazy',
        lazyChildrenKey: 'traits',
      },
      {
        label: 'Secret References',
        type: 'infra-category',
        contextValue: 'infra-category',
        namespace: ns,
        childrenMode: 'lazy',
        lazyChildrenKey: 'secret-references',
      },
      {
        label: 'RBAC',
        type: 'infra-category',
        contextValue: 'infra-category',
        namespace: ns,
        childrenMode: 'preloaded',
        children: [
          {
            label: 'Namespace Roles',
            type: 'infra-category',
            contextValue: 'infra-category',
            namespace: ns,
            childrenMode: 'lazy',
            lazyChildrenKey: 'namespace-roles',
          },
          {
            label: 'Namespace Role Bindings',
            type: 'infra-category',
            contextValue: 'infra-category',
            namespace: ns,
            childrenMode: 'lazy',
            lazyChildrenKey: 'namespace-role-bindings',
          },
          {
            label: 'Cluster Roles',
            type: 'infra-category',
            contextValue: 'infra-category',
            namespace: ns,
            childrenMode: 'lazy',
            lazyChildrenKey: 'cluster-roles',
          },
          {
            label: 'Cluster Role Bindings',
            type: 'infra-category',
            contextValue: 'infra-category',
            namespace: ns,
            childrenMode: 'lazy',
            lazyChildrenKey: 'cluster-role-bindings',
          },
        ],
      },
    ];
  }

  private static readonly EDITABLE_TYPES: ReadonlySet<ResourceNodeType> =
    new Set([
      'component-type',
      'workflow',
      'component-workflow',
      'trait',
      'environment',
      'data-plane',
      'build-plane',
      'observability-plane',
      'deployment-pipeline',
      'secret-reference',
      'namespace-role',
      'namespace-role-binding',
      'cluster-role',
      'cluster-role-binding',
    ]);

  private resolveContextValue(type: ResourceNodeType): string {
    let value: string = type;
    if (InfrastructureExplorerProvider.EDITABLE_TYPES.has(type)) {
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
      // Ensure RBAC capabilities are loaded before building nodes
      await this.capabilityService.ensureLoaded(element.namespace);

      switch (element.lazyChildrenKey) {
        case 'workflows':
          return this.fetchWorkflows(element.namespace!);
        case 'environments':
          return this.fetchEnvironments(element.namespace!);
        case 'data-planes':
          return this.fetchDataPlanes(element.namespace!);
        case 'build-planes':
          return this.fetchBuildPlanes(element.namespace!);
        case 'observability-planes':
          return this.fetchObservabilityPlanes(element.namespace!);
        case 'component-types':
          return this.fetchComponentTypes(element.namespace!);
        case 'component-workflows':
          return this.fetchComponentWorkflows(element.namespace!);
        case 'traits':
          return this.fetchTraits(element.namespace!);
        case 'secret-references':
          return this.fetchSecretReferences(element.namespace!);
        case 'namespace-roles':
          return this.fetchNamespaceRoles(element.namespace!);
        case 'namespace-role-bindings':
          return this.fetchNamespaceRoleBindings(element.namespace!);
        case 'cluster-roles':
          return this.fetchClusterRoles();
        case 'cluster-role-bindings':
          return this.fetchClusterRoleBindings();
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

  // --- New API endpoints ---

  private async fetchEnvironments(ns: string): Promise<ResourceNodeData[]> {
    const client = await this.requireClient();
    const { data, error } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/environments',
      { params: { path: { namespaceName: ns } } },
    );

    if (error) {
      return [];
    }

    const items = data?.items ?? [];
    if (items.length === 0) {
      return [
        { label: 'No environments', type: 'empty', contextValue: 'empty', childrenMode: 'none' },
      ];
    }

    return items.map((item) => ({
      label: (item.metadata?.name as string) ?? 'unknown',
      type: 'environment' as const,
      contextValue: this.resolveContextValue('environment'),
      description: (item.spec as { dataPlaneRef?: string } | undefined)?.dataPlaneRef
        ? `dp: ${(item.spec as { dataPlaneRef?: string }).dataPlaneRef}`
        : undefined,
      namespace: ns,
      resourceName: item.metadata?.name as string,
      childrenMode: 'none' as const,
    }));
  }

  private async fetchDataPlanes(ns: string): Promise<ResourceNodeData[]> {
    const client = await this.requireClient();
    const { data, error } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/dataplanes',
      { params: { path: { namespaceName: ns } } },
    );

    if (error) {
      return [];
    }

    const items = data?.items ?? [];
    if (items.length === 0) {
      return [
        { label: 'No data planes', type: 'empty', contextValue: 'empty', childrenMode: 'none' },
      ];
    }

    return items.map((item) => ({
      label: (item.metadata?.name as string) ?? 'unknown',
      type: 'data-plane' as const,
      contextValue: this.resolveContextValue('data-plane'),
      namespace: ns,
      resourceName: item.metadata?.name as string,
      childrenMode: 'none' as const,
    }));
  }

  private async fetchBuildPlanes(ns: string): Promise<ResourceNodeData[]> {
    const client = await this.requireClient();
    const { data, error } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/buildplanes',
      { params: { path: { namespaceName: ns } } },
    );

    if (error) {
      return [];
    }

    const items = data?.items ?? [];
    if (items.length === 0) {
      return [
        { label: 'No build planes', type: 'empty', contextValue: 'empty', childrenMode: 'none' },
      ];
    }

    return items.map((item) => ({
      label: (item.metadata?.name as string) ?? 'unknown',
      type: 'build-plane' as const,
      contextValue: this.resolveContextValue('build-plane'),
      namespace: ns,
      resourceName: item.metadata?.name as string,
      childrenMode: 'none' as const,
    }));
  }

  private async fetchObservabilityPlanes(
    ns: string,
  ): Promise<ResourceNodeData[]> {
    const client = await this.requireClient();
    const { data, error } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/observabilityplanes',
      { params: { path: { namespaceName: ns } } },
    );

    if (error) {
      return [];
    }

    const items = data?.items ?? [];
    if (items.length === 0) {
      return [
        {
          label: 'No observability planes',
          type: 'empty',
          contextValue: 'empty',
          childrenMode: 'none',
        },
      ];
    }

    return items.map((item) => ({
      label: (item.metadata?.name as string) ?? 'unknown',
      type: 'observability-plane' as const,
      contextValue: this.resolveContextValue('observability-plane'),
      namespace: ns,
      resourceName: item.metadata?.name as string,
      childrenMode: 'none' as const,
    }));
  }

  private async fetchComponentTypes(ns: string): Promise<ResourceNodeData[]> {
    const client = await this.requireClient();
    const { data, error } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/component-types',
      { params: { path: { namespaceName: ns } } },
    );

    if (error) {
      return [];
    }

    const items = data?.items ?? [];
    if (items.length === 0) {
      return [
        {
          label: 'No component types',
          type: 'empty',
          contextValue: 'empty',
          childrenMode: 'none',
        },
      ];
    }

    return items.map((item) => ({
      label: (item.metadata?.name as string) ?? 'unknown',
      type: 'component-type' as const,
      contextValue: this.resolveContextValue('component-type'),
      namespace: ns,
      resourceName: item.metadata?.name as string,
      childrenMode: 'none' as const,
    }));
  }

  /** Workflows use the legacy API (not yet in new API). */
  private async fetchWorkflows(ns: string): Promise<ResourceNodeData[]> {
    const legacyClient = await this.requireLegacyClient();
    const { data, error } = await legacyClient.GET(
      '/namespaces/{namespaceName}/workflows',
      { params: { path: { namespaceName: ns } } },
    );

    if (error) {
      return [];
    }

    const items =
      (data?.data as { items?: Array<{ name?: string }> })?.items ?? [];
    if (items.length === 0) {
      return [
        { label: 'No workflows', type: 'empty', contextValue: 'empty', childrenMode: 'none' },
      ];
    }

    return items.map((item) => ({
      label: (item.name as string) ?? 'unknown',
      type: 'workflow' as const,
      contextValue: this.resolveContextValue('workflow'),
      namespace: ns,
      resourceName: item.name as string,
      childrenMode: 'none' as const,
    }));
  }

  private async fetchComponentWorkflows(
    ns: string,
  ): Promise<ResourceNodeData[]> {
    const client = await this.requireClient();
    const { data, error } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/component-workflows',
      { params: { path: { namespaceName: ns } } },
    );

    if (error) {
      return [];
    }

    const items = data?.items ?? [];
    if (items.length === 0) {
      return [
        {
          label: 'No component workflows',
          type: 'empty',
          contextValue: 'empty',
          childrenMode: 'none',
        },
      ];
    }

    return items.map((item) => ({
      label: (item.name as string) ?? 'unknown',
      type: 'component-workflow' as const,
      contextValue: this.resolveContextValue('component-workflow'),
      namespace: ns,
      resourceName: item.name as string,
      childrenMode: 'none' as const,
    }));
  }

  private async fetchTraits(ns: string): Promise<ResourceNodeData[]> {
    const client = await this.requireClient();
    const { data, error } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/traits',
      { params: { path: { namespaceName: ns } } },
    );

    if (error) {
      return [];
    }

    const items = data?.items ?? [];
    if (items.length === 0) {
      return [
        { label: 'No traits', type: 'empty', contextValue: 'empty', childrenMode: 'none' },
      ];
    }

    return items.map((item) => ({
      label: (item.metadata?.name as string) ?? 'unknown',
      type: 'trait' as const,
      contextValue: this.resolveContextValue('trait'),
      namespace: ns,
      resourceName: item.metadata?.name as string,
      childrenMode: 'none' as const,
    }));
  }

  private async fetchSecretReferences(
    ns: string,
  ): Promise<ResourceNodeData[]> {
    const client = await this.requireClient();
    const { data, error } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/secret-references',
      { params: { path: { namespaceName: ns } } },
    );

    if (error) {
      return [];
    }

    const items = data?.items ?? [];
    if (items.length === 0) {
      return [
        {
          label: 'No secret references',
          type: 'empty',
          contextValue: 'empty',
          childrenMode: 'none',
        },
      ];
    }

    return items.map((item) => ({
      label: (item.metadata?.name as string) ?? 'unknown',
      type: 'secret-reference' as const,
      contextValue: this.resolveContextValue('secret-reference'),
      namespace: ns,
      resourceName: item.metadata?.name as string,
      childrenMode: 'none' as const,
    }));
  }

  private async fetchNamespaceRoles(ns: string): Promise<ResourceNodeData[]> {
    const client = await this.requireClient();
    const { data, error } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/roles',
      { params: { path: { namespaceName: ns } } },
    );

    if (error) {
      return [];
    }

    // RBAC roles return an array directly, not { items: [...] }
    const items = (data as Array<{ name?: string }>) ?? [];
    if (items.length === 0) {
      return [
        {
          label: 'No namespace roles',
          type: 'empty',
          contextValue: 'empty',
          childrenMode: 'none',
        },
      ];
    }

    return items.map((item) => ({
      label: (item.name as string) ?? 'unknown',
      type: 'namespace-role' as const,
      contextValue: this.resolveContextValue('namespace-role'),
      namespace: ns,
      resourceName: item.name as string,
      childrenMode: 'none' as const,
    }));
  }

  private async fetchNamespaceRoleBindings(
    ns: string,
  ): Promise<ResourceNodeData[]> {
    const client = await this.requireClient();
    const { data, error } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/rolebindings',
      { params: { path: { namespaceName: ns } } },
    );

    if (error) {
      return [];
    }

    const items = (data as Array<{ name?: string }>) ?? [];
    if (items.length === 0) {
      return [
        {
          label: 'No namespace role bindings',
          type: 'empty',
          contextValue: 'empty',
          childrenMode: 'none',
        },
      ];
    }

    return items.map((item) => ({
      label: (item.name as string) ?? 'unknown',
      type: 'namespace-role-binding' as const,
      contextValue: this.resolveContextValue('namespace-role-binding'),
      namespace: ns,
      resourceName: item.name as string,
      childrenMode: 'none' as const,
    }));
  }

  private async fetchClusterRoles(): Promise<ResourceNodeData[]> {
    const client = await this.requireClient();
    const { data, error } = await client.GET('/api/v1/clusterroles');

    if (error) {
      return [];
    }

    const items = (data as Array<{ name?: string }>) ?? [];
    if (items.length === 0) {
      return [
        {
          label: 'No cluster roles',
          type: 'empty',
          contextValue: 'empty',
          childrenMode: 'none',
        },
      ];
    }

    return items.map((item) => ({
      label: (item.name as string) ?? 'unknown',
      type: 'cluster-role' as const,
      contextValue: this.resolveContextValue('cluster-role'),
      resourceName: item.name as string,
      childrenMode: 'none' as const,
    }));
  }

  private async fetchClusterRoleBindings(): Promise<ResourceNodeData[]> {
    const client = await this.requireClient();
    const { data, error } = await client.GET('/api/v1/clusterrolebindings');

    if (error) {
      return [];
    }

    const items = (data as Array<{ name?: string }>) ?? [];
    if (items.length === 0) {
      return [
        {
          label: 'No cluster role bindings',
          type: 'empty',
          contextValue: 'empty',
          childrenMode: 'none',
        },
      ];
    }

    return items.map((item) => ({
      label: (item.name as string) ?? 'unknown',
      type: 'cluster-role-binding' as const,
      contextValue: this.resolveContextValue('cluster-role-binding'),
      resourceName: item.name as string,
      childrenMode: 'none' as const,
    }));
  }

  // --- Helpers ---

  private async requireClient(): Promise<Client> {
    const client = await this.apiClientManager.getClient();
    if (!client) {
      throw new Error('Not authenticated');
    }
    return client;
  }

  private async requireLegacyClient(): Promise<LegacyClient> {
    const client = await this.apiClientManager.getLegacyClient();
    if (!client) {
      throw new Error('Not authenticated');
    }
    return client;
  }
}

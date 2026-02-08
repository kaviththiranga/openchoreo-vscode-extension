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
        label: 'Git Secrets',
        type: 'infra-category',
        contextValue: 'infra-category',
        namespace: ns,
        childrenMode: 'lazy',
        lazyChildrenKey: 'git-secrets',
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

  private resolveContextValue(type: ResourceNodeType): string {
    return this.capabilityService.canDelete(type)
      ? `${type}_deletable`
      : type;
  }

  private async fetchLazyChildren(
    element: ResourceNodeData,
  ): Promise<ResourceNodeData[]> {
    try {
      const client = await this.apiClientManager.getClient();
      if (!client) {
        return [];
      }

      // Ensure RBAC capabilities are loaded before building nodes
      await this.capabilityService.ensureLoaded(element.namespace);

      switch (element.lazyChildrenKey) {
        case 'environments':
          return this.fetchEnvironments(client, element.namespace!);
        case 'data-planes':
          return this.fetchDataPlanes(client, element.namespace!);
        case 'build-planes':
          return this.fetchBuildPlanes(client, element.namespace!);
        case 'observability-planes':
          return this.fetchObservabilityPlanes(client, element.namespace!);
        case 'component-types':
          return this.fetchComponentTypes(client, element.namespace!);
        case 'workflows':
          return this.fetchWorkflows(client, element.namespace!);
        case 'component-workflows':
          return this.fetchComponentWorkflows(client, element.namespace!);
        case 'traits':
          return this.fetchTraits(client, element.namespace!);
        case 'secret-references':
          return this.fetchSecretReferences(client, element.namespace!);
        case 'git-secrets':
          return this.fetchGitSecrets(client, element.namespace!);
        case 'namespace-roles':
          return this.fetchNamespaceRoles(client, element.namespace!);
        case 'namespace-role-bindings':
          return this.fetchNamespaceRoleBindings(client, element.namespace!);
        case 'cluster-roles':
          return this.fetchClusterRoles(client);
        case 'cluster-role-bindings':
          return this.fetchClusterRoleBindings(client);
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

  private async fetchEnvironments(
    client: Client,
    ns: string,
  ): Promise<ResourceNodeData[]> {
    const { data, error } = await client.GET(
      '/namespaces/{namespaceName}/environments',
      { params: { path: { namespaceName: ns } } },
    );

    if (error) {
      return [];
    }

    const items =
      (data?.data as { items?: Array<{ name?: string; dataPlane?: string }> })
        ?.items ?? [];
    if (items.length === 0) {
      return [
        { label: 'No environments', type: 'empty', contextValue: 'empty', childrenMode: 'none' },
      ];
    }

    return items.map((item) => ({
      label: (item.name as string) ?? 'unknown',
      type: 'environment' as const,
      contextValue: 'environment',
      description: item.dataPlane ? `dp: ${item.dataPlane}` : undefined,
      namespace: ns,
      resourceName: item.name as string,
      childrenMode: 'none' as const,
    }));
  }

  private async fetchDataPlanes(
    client: Client,
    ns: string,
  ): Promise<ResourceNodeData[]> {
    const { data, error } = await client.GET(
      '/namespaces/{namespaceName}/dataplanes',
      { params: { path: { namespaceName: ns } } },
    );

    if (error) {
      return [];
    }

    const items =
      (data?.data as { items?: Array<{ name?: string; status?: string }> })
        ?.items ?? [];
    if (items.length === 0) {
      return [
        { label: 'No data planes', type: 'empty', contextValue: 'empty', childrenMode: 'none' },
      ];
    }

    return items.map((item) => ({
      label: (item.name as string) ?? 'unknown',
      type: 'data-plane' as const,
      contextValue: 'data-plane',
      description: item.status as string | undefined,
      namespace: ns,
      resourceName: item.name as string,
      childrenMode: 'none' as const,
    }));
  }

  private async fetchBuildPlanes(
    client: Client,
    ns: string,
  ): Promise<ResourceNodeData[]> {
    const { data, error } = await client.GET(
      '/namespaces/{namespaceName}/buildplanes',
      { params: { path: { namespaceName: ns } } },
    );

    if (error) {
      return [];
    }

    const items =
      (data?.data as { items?: Array<{ name?: string }> })?.items ?? [];
    if (items.length === 0) {
      return [
        { label: 'No build planes', type: 'empty', contextValue: 'empty', childrenMode: 'none' },
      ];
    }

    return items.map((item) => ({
      label: (item.name as string) ?? 'unknown',
      type: 'build-plane' as const,
      contextValue: 'build-plane',
      namespace: ns,
      resourceName: item.name as string,
      childrenMode: 'none' as const,
    }));
  }

  private async fetchObservabilityPlanes(
    client: Client,
    ns: string,
  ): Promise<ResourceNodeData[]> {
    const { data, error } = await client.GET(
      '/namespaces/{namespaceName}/observabilityplanes',
      { params: { path: { namespaceName: ns } } },
    );

    if (error) {
      return [];
    }

    const items =
      (data?.data as { items?: Array<{ name?: string }> })?.items ?? [];
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
      label: (item.name as string) ?? 'unknown',
      type: 'observability-plane' as const,
      contextValue: 'observability-plane',
      namespace: ns,
      resourceName: item.name as string,
      childrenMode: 'none' as const,
    }));
  }

  private async fetchComponentTypes(
    client: Client,
    ns: string,
  ): Promise<ResourceNodeData[]> {
    const { data, error } = await client.GET(
      '/namespaces/{namespaceName}/component-types',
      { params: { path: { namespaceName: ns } } },
    );

    if (error) {
      return [];
    }

    const items =
      (data?.data as { items?: Array<{ name?: string }> })?.items ?? [];
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
      label: (item.name as string) ?? 'unknown',
      type: 'component-type' as const,
      contextValue: this.resolveContextValue('component-type'),
      namespace: ns,
      resourceName: item.name as string,
      childrenMode: 'none' as const,
    }));
  }

  private async fetchWorkflows(
    client: Client,
    ns: string,
  ): Promise<ResourceNodeData[]> {
    const { data, error } = await client.GET(
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
    client: Client,
    ns: string,
  ): Promise<ResourceNodeData[]> {
    const { data, error } = await client.GET(
      '/namespaces/{namespaceName}/component-workflows',
      { params: { path: { namespaceName: ns } } },
    );

    if (error) {
      return [];
    }

    const items =
      (data?.data as { items?: Array<{ name?: string }> })?.items ?? [];
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

  private async fetchTraits(
    client: Client,
    ns: string,
  ): Promise<ResourceNodeData[]> {
    const { data, error } = await client.GET(
      '/namespaces/{namespaceName}/traits',
      { params: { path: { namespaceName: ns } } },
    );

    if (error) {
      return [];
    }

    const items =
      (data?.data as { items?: Array<{ name?: string }> })?.items ?? [];
    if (items.length === 0) {
      return [
        { label: 'No traits', type: 'empty', contextValue: 'empty', childrenMode: 'none' },
      ];
    }

    return items.map((item) => ({
      label: (item.name as string) ?? 'unknown',
      type: 'trait' as const,
      contextValue: this.resolveContextValue('trait'),
      namespace: ns,
      resourceName: item.name as string,
      childrenMode: 'none' as const,
    }));
  }

  private async fetchSecretReferences(
    client: Client,
    ns: string,
  ): Promise<ResourceNodeData[]> {
    const { data, error } = await client.GET(
      '/namespaces/{namespaceName}/secret-references',
      { params: { path: { namespaceName: ns } } },
    );

    if (error) {
      return [];
    }

    const items =
      (data?.data as { items?: Array<{ name?: string }> })?.items ?? [];
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
      label: (item.name as string) ?? 'unknown',
      type: 'secret-reference' as const,
      contextValue: 'secret-reference',
      namespace: ns,
      resourceName: item.name as string,
      childrenMode: 'none' as const,
    }));
  }

  private async fetchGitSecrets(
    client: Client,
    ns: string,
  ): Promise<ResourceNodeData[]> {
    const { data, error } = await client.GET(
      '/namespaces/{namespaceName}/git-secrets',
      { params: { path: { namespaceName: ns } } },
    );

    if (error) {
      return [];
    }

    const items =
      (data?.data as { items?: Array<{ name?: string }> })?.items ?? [];
    if (items.length === 0) {
      return [
        { label: 'No git secrets', type: 'empty', contextValue: 'empty', childrenMode: 'none' },
      ];
    }

    return items.map((item) => ({
      label: (item.name as string) ?? 'unknown',
      type: 'git-secret' as const,
      contextValue: this.resolveContextValue('git-secret'),
      namespace: ns,
      resourceName: item.name as string,
      childrenMode: 'none' as const,
    }));
  }

  private async fetchNamespaceRoles(
    client: Client,
    ns: string,
  ): Promise<ResourceNodeData[]> {
    // Note: RBAC endpoints use {namespace} not {namespaceName}
    const { data, error } = await client.GET(
      '/namespaces/{namespace}/roles',
      { params: { path: { namespace: ns } } },
    );

    if (error) {
      return [];
    }

    const items =
      (data?.data as { items?: Array<{ name?: string }> })?.items ?? [];
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
    client: Client,
    ns: string,
  ): Promise<ResourceNodeData[]> {
    const { data, error } = await client.GET(
      '/namespaces/{namespace}/rolebindings',
      { params: { path: { namespace: ns } } },
    );

    if (error) {
      return [];
    }

    const items =
      (data?.data as { items?: Array<{ name?: string }> })?.items ?? [];
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

  private async fetchClusterRoles(
    client: Client,
  ): Promise<ResourceNodeData[]> {
    const { data, error } = await client.GET('/clusterroles');

    if (error) {
      return [];
    }

    const items =
      (data?.data as { items?: Array<{ name?: string }> })?.items ?? [];
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

  private async fetchClusterRoleBindings(
    client: Client,
  ): Promise<ResourceNodeData[]> {
    const { data, error } = await client.GET('/clusterrolebindings');

    if (error) {
      return [];
    }

    const items =
      (data?.data as { items?: Array<{ name?: string }> })?.items ?? [];
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
}

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { OccConfigAuthProvider } from '../auth/authProvider';
import type { ApiClientManager } from '../api/apiClient';

type ResourceNodeType =
  | 'namespace'
  | 'project'
  | 'component'
  | 'environment'
  | 'no-connection';

interface ResourceNodeData {
  label: string;
  type: ResourceNodeType;
  contextValue: string;
  namespace?: string;
  project?: string;
  component?: string;
  children?: ResourceNodeData[];
}

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
    // Refresh tree when auth session changes
    authProvider.onDidChangeSession(() => this.refresh());
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: ResourceNodeData): vscode.TreeItem {
    const collapsible =
      element.type === 'no-connection'
        ? vscode.TreeItemCollapsibleState.None
        : element.children
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None;

    const treeItem = new vscode.TreeItem(element.label, collapsible);
    treeItem.contextValue = element.contextValue;

    switch (element.type) {
      case 'namespace':
        treeItem.iconPath = new vscode.ThemeIcon('database');
        break;
      case 'project':
        treeItem.iconPath = new vscode.ThemeIcon('folder');
        break;
      case 'component':
        treeItem.iconPath = new vscode.ThemeIcon('package');
        break;
      case 'environment':
        treeItem.iconPath = new vscode.ThemeIcon('server-environment');
        break;
      case 'no-connection':
        treeItem.iconPath = new vscode.ThemeIcon('warning');
        break;
    }

    // All resource nodes are clickable to open their API response
    if (element.type !== 'no-connection') {
      treeItem.command = {
        command: 'openchoreo.openResource',
        title: 'Open Resource',
        arguments: [element],
      };
    }

    return treeItem;
  }

  async getChildren(
    element?: ResourceNodeData,
  ): Promise<ResourceNodeData[]> {
    // Root level: check authentication
    if (!element) {
      return this.getRootNodes();
    }

    // Children of a node
    return element.children ?? [];
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
          },
        ];
      }
      return [
        {
          label: 'No context configured',
          type: 'no-connection',
          contextValue: 'no-connection',
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
          },
        ];
      }

      // Fetch projects from the API using typed client
      const projects = await this.fetchProjects(
        client,
        contextInfo.namespace,
      );

      if (projects.length === 0) {
        return [
          {
            label: `${contextInfo.namespace} (no projects)`,
            type: 'namespace',
            contextValue: 'namespace',
            namespace: contextInfo.namespace,
          },
        ];
      }

      // Build namespace → project → component tree
      const namespaceNode: ResourceNodeData = {
        label: contextInfo.namespace,
        type: 'namespace',
        contextValue: 'namespace',
        namespace: contextInfo.namespace,
        children: projects.map((project) => ({
          label: project.name,
          type: 'project' as ResourceNodeType,
          contextValue: 'project',
          namespace: contextInfo.namespace,
          project: project.name,
          children: project.components.map((comp) => ({
            label: comp.name,
            type: 'component' as ResourceNodeType,
            contextValue: 'component',
            namespace: contextInfo.namespace,
            project: project.name,
            component: comp.name,
          })),
        })),
      };

      return [namespaceNode];
    } catch (error) {
      return [
        {
          label: `Error: ${error instanceof Error ? error.message : 'Failed to fetch resources'}`,
          type: 'no-connection',
          contextValue: 'no-connection',
        },
      ];
    }
  }

  private async fetchProjects(
    client: NonNullable<Awaited<ReturnType<ApiClientManager['getClient']>>>,
    namespace: string,
  ): Promise<
    Array<{
      name: string;
      components: Array<{ name: string }>;
    }>
  > {
    // Fetch projects using typed client
    const { data: projectsData, error: projectsError } = await client.GET(
      '/namespaces/{namespaceName}/projects',
      {
        params: { path: { namespaceName: namespace } },
      },
    );

    if (projectsError) {
      throw new Error('Failed to fetch projects');
    }

    const projectItems = projectsData?.data?.items ?? [];

    // Fetch components for each project
    const results = await Promise.all(
      projectItems.map(async (project) => {
        const projectName = project.name as string;
        try {
          const { data: componentsData } = await client.GET(
            '/namespaces/{namespaceName}/projects/{projectName}/components',
            {
              params: {
                path: {
                  namespaceName: namespace,
                  projectName,
                },
              },
            },
          );

          return {
            name: projectName,
            components: (componentsData?.data?.items ?? []).map((c) => ({
              name: c.name as string,
            })),
          };
        } catch {
          return { name: projectName, components: [] };
        }
      }),
    );

    return results;
  }
}

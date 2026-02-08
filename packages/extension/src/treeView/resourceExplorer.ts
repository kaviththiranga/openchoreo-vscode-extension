// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { OccConfigAuthProvider } from '../auth/authProvider';

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

  constructor(private readonly authProvider: OccConfigAuthProvider) {
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

    const contextInfo = this.authProvider.getContextInfo();
    if (!contextInfo) {
      return [
        {
          label: 'No context configured',
          type: 'no-connection',
          contextValue: 'no-connection',
        },
      ];
    }

    try {
      const token = await this.authProvider.getToken();
      if (!token) {
        return [
          {
            label: 'Session expired. Run "occ login" to re-authenticate.',
            type: 'no-connection',
            contextValue: 'no-connection',
          },
        ];
      }

      // Fetch projects from the API
      const projects = await this.fetchProjects(
        session.controlPlaneUrl,
        contextInfo.namespace,
        token,
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
    controlPlaneUrl: string,
    namespace: string,
    token: string,
  ): Promise<
    Array<{
      name: string;
      components: Array<{ name: string }>;
    }>
  > {
    const baseUrl = `${controlPlaneUrl}/api/v1`;

    // Fetch projects
    const projectsRes = await fetch(
      `${baseUrl}/namespaces/${namespace}/projects`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!projectsRes.ok) {
      throw new Error(`Failed to fetch projects: ${projectsRes.status}`);
    }

    const projectsData = (await projectsRes.json()) as {
      data?: { items?: Array<{ name: string }> };
    };
    const projectItems = projectsData.data?.items ?? [];

    // Fetch components for each project
    const results = await Promise.all(
      projectItems.map(async (project) => {
        try {
          const componentsRes = await fetch(
            `${baseUrl}/namespaces/${namespace}/projects/${project.name}/components`,
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );

          if (!componentsRes.ok) {
            return { name: project.name, components: [] };
          }

          const componentsData = (await componentsRes.json()) as {
            data?: { items?: Array<{ name: string }> };
          };
          return {
            name: project.name,
            components: componentsData.data?.items ?? [],
          };
        } catch {
          return { name: project.name, components: [] };
        }
      }),
    );

    return results;
  }
}

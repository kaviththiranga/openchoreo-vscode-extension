// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { ApiClientManager } from '../api/apiClient';
import type { ResourceNodeData } from '../treeView/types';

type Client = NonNullable<
  Awaited<ReturnType<ApiClientManager['getClient']>>
>;

/**
 * Handles delete operations for OpenChoreo resources.
 * Maps each deletable ResourceNodeType to the appropriate DELETE API call.
 */
export class DeleteService {
  constructor(private readonly apiClientManager: ApiClientManager) {}

  async deleteResource(node: ResourceNodeData): Promise<void> {
    const client = await this.apiClientManager.getClient();
    if (!client) {
      throw new Error('Not authenticated. Run "occ login" first.');
    }

    switch (node.type) {
      case 'project':
        return this.deleteProject(client, node);
      case 'component':
        return this.deleteComponent(client, node);
      case 'git-secret':
        return this.deleteGitSecret(client, node);
      case 'component-type':
        return this.deleteComponentType(client, node);
      case 'workflow':
        return this.deleteWorkflow(client, node);
      case 'component-workflow':
        return this.deleteComponentWorkflow(client, node);
      case 'trait':
        return this.deleteTrait(client, node);
      case 'cluster-role':
        return this.deleteClusterRole(client, node);
      case 'namespace-role':
        return this.deleteNamespaceRole(client, node);
      case 'cluster-role-binding':
        return this.deleteClusterRoleBinding(client, node);
      case 'namespace-role-binding':
        return this.deleteNamespaceRoleBinding(client, node);
      default:
        throw new Error(`Delete not supported for resource type: ${node.type}`);
    }
  }

  private async deleteProject(
    client: Client,
    node: ResourceNodeData,
  ): Promise<void> {
    const { error } = await client.DELETE(
      '/namespaces/{namespaceName}/projects/{projectName}',
      {
        params: {
          path: {
            namespaceName: node.namespace!,
            projectName: node.resourceName ?? node.label,
          },
        },
      },
    );
    if (error) {
      throw new Error(
        `Failed to delete project: ${JSON.stringify(error)}`,
      );
    }
  }

  private async deleteComponent(
    client: Client,
    node: ResourceNodeData,
  ): Promise<void> {
    const { error } = await client.DELETE(
      '/namespaces/{namespaceName}/projects/{projectName}/components/{componentName}',
      {
        params: {
          path: {
            namespaceName: node.namespace!,
            projectName: node.project!,
            componentName: node.resourceName ?? node.label,
          },
        },
      },
    );
    if (error) {
      throw new Error(
        `Failed to delete component: ${JSON.stringify(error)}`,
      );
    }
  }

  private async deleteGitSecret(
    client: Client,
    node: ResourceNodeData,
  ): Promise<void> {
    const { error } = await client.DELETE(
      '/namespaces/{namespaceName}/git-secrets/{secretName}',
      {
        params: {
          path: {
            namespaceName: node.namespace!,
            secretName: node.resourceName ?? node.label,
          },
        },
      },
    );
    if (error) {
      throw new Error(
        `Failed to delete git secret: ${JSON.stringify(error)}`,
      );
    }
  }

  private async deleteComponentType(
    client: Client,
    node: ResourceNodeData,
  ): Promise<void> {
    const { error } = await client.DELETE(
      '/namespaces/{namespaceName}/component-types/{ctName}/definition',
      {
        params: {
          path: {
            namespaceName: node.namespace!,
            ctName: node.resourceName ?? node.label,
          },
        },
      },
    );
    if (error) {
      throw new Error(
        `Failed to delete component type: ${JSON.stringify(error)}`,
      );
    }
  }

  private async deleteWorkflow(
    client: Client,
    node: ResourceNodeData,
  ): Promise<void> {
    const { error } = await client.DELETE(
      '/namespaces/{namespaceName}/workflows/{workflowName}/definition',
      {
        params: {
          path: {
            namespaceName: node.namespace!,
            workflowName: node.resourceName ?? node.label,
          },
        },
      },
    );
    if (error) {
      throw new Error(
        `Failed to delete workflow: ${JSON.stringify(error)}`,
      );
    }
  }

  private async deleteComponentWorkflow(
    client: Client,
    node: ResourceNodeData,
  ): Promise<void> {
    const { error } = await client.DELETE(
      '/namespaces/{namespaceName}/component-workflows/{cwName}/definition',
      {
        params: {
          path: {
            namespaceName: node.namespace!,
            cwName: node.resourceName ?? node.label,
          },
        },
      },
    );
    if (error) {
      throw new Error(
        `Failed to delete component workflow: ${JSON.stringify(error)}`,
      );
    }
  }

  private async deleteTrait(
    client: Client,
    node: ResourceNodeData,
  ): Promise<void> {
    const { error } = await client.DELETE(
      '/namespaces/{namespaceName}/traits/{traitName}/definition',
      {
        params: {
          path: {
            namespaceName: node.namespace!,
            traitName: node.resourceName ?? node.label,
          },
        },
      },
    );
    if (error) {
      throw new Error(
        `Failed to delete trait: ${JSON.stringify(error)}`,
      );
    }
  }

  private async deleteClusterRole(
    client: Client,
    node: ResourceNodeData,
  ): Promise<void> {
    const { error } = await client.DELETE('/clusterroles/{name}', {
      params: {
        path: { name: node.resourceName ?? node.label },
      },
    });
    if (error) {
      throw new Error(
        `Failed to delete cluster role: ${JSON.stringify(error)}`,
      );
    }
  }

  private async deleteNamespaceRole(
    client: Client,
    node: ResourceNodeData,
  ): Promise<void> {
    const { error } = await client.DELETE(
      '/namespaces/{namespace}/roles/{name}',
      {
        params: {
          path: {
            namespace: node.namespace!,
            name: node.resourceName ?? node.label,
          },
        },
      },
    );
    if (error) {
      throw new Error(
        `Failed to delete namespace role: ${JSON.stringify(error)}`,
      );
    }
  }

  private async deleteClusterRoleBinding(
    client: Client,
    node: ResourceNodeData,
  ): Promise<void> {
    const { error } = await client.DELETE('/clusterrolebindings/{name}', {
      params: {
        path: { name: node.resourceName ?? node.label },
      },
    });
    if (error) {
      throw new Error(
        `Failed to delete cluster role binding: ${JSON.stringify(error)}`,
      );
    }
  }

  private async deleteNamespaceRoleBinding(
    client: Client,
    node: ResourceNodeData,
  ): Promise<void> {
    const { error } = await client.DELETE(
      '/namespaces/{namespace}/rolebindings/{name}',
      {
        params: {
          path: {
            namespace: node.namespace!,
            name: node.resourceName ?? node.label,
          },
        },
      },
    );
    if (error) {
      throw new Error(
        `Failed to delete namespace role binding: ${JSON.stringify(error)}`,
      );
    }
  }
}

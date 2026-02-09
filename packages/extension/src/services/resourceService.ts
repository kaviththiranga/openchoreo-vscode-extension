// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { ApiClientManager } from '../api/apiClient';
import type { ResourceNodeType } from '../treeView/types';

type Client = NonNullable<
  Awaited<ReturnType<ApiClientManager['getClient']>>
>;

/** Maps tree-view node types to their PascalCase CRD kind. */
const NODE_TYPE_TO_CRD_KIND: Partial<Record<ResourceNodeType, string>> = {
  'component-type': 'ComponentType',
  workflow: 'Workflow',
  'component-workflow': 'ComponentWorkflow',
  trait: 'Trait',
  project: 'Project',
  component: 'Component',
  environment: 'Environment',
  'data-plane': 'DataPlane',
  'build-plane': 'BuildPlane',
  'observability-plane': 'ObservabilityPlane',
  'deployment-pipeline': 'DeploymentPipeline',
  'secret-reference': 'SecretReference',
  'git-secret': 'GitSecret',
  'namespace-role': 'NamespaceRole',
  'namespace-role-binding': 'NamespaceRoleBinding',
  'cluster-role': 'ClusterRole',
  'cluster-role-binding': 'ClusterRoleBinding',
};

/** Kinds that live at the cluster scope (no namespace in the path). */
const CLUSTER_SCOPED_KINDS = new Set(['ClusterRole', 'ClusterRoleBinding']);

export class ResourceService {
  getCrdKind(nodeType: ResourceNodeType): string | undefined {
    return NODE_TYPE_TO_CRD_KIND[nodeType];
  }

  /** Deletes a resource using the generic DELETE /delete endpoint. */
  async deleteResource(
    client: Client,
    nodeType: ResourceNodeType,
    namespace: string | undefined,
    name: string,
  ): Promise<void> {
    const kind = NODE_TYPE_TO_CRD_KIND[nodeType];
    if (!kind) {
      throw new Error(`No CRD kind mapping for type: ${nodeType}`);
    }

    const metadata: Record<string, string> = { name };
    if (namespace && !CLUSTER_SCOPED_KINDS.has(kind)) {
      metadata.namespace = namespace;
    }

    const body = {
      apiVersion: 'openchoreo.dev/v1alpha1',
      kind,
      metadata,
    };

    const { error } = await client.DELETE('/delete', {
      body,
    });
    if (error) {
      throw new Error(`Failed to delete ${nodeType}: ${JSON.stringify(error)}`);
    }
  }
}

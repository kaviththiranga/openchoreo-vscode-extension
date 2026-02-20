// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { ApiClientManager } from '../api/apiClient';
import type { ResourceNodeType } from '../treeView/types';

type Client = NonNullable<
  Awaited<ReturnType<ApiClientManager['getClient']>>
>;

type LegacyClient = NonNullable<
  Awaited<ReturnType<ApiClientManager['getLegacyClient']>>
>;

/** Maps tree-view node types to their PascalCase CRD kind (used by apply command). */
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
  workload: 'Workload',
  'component-release': 'ComponentRelease',
  'release-binding': 'ReleaseBinding',
  'namespace-role': 'NamespaceRole',
  'namespace-role-binding': 'NamespaceRoleBinding',
  'cluster-role': 'ClusterRole',
  'cluster-role-binding': 'ClusterRoleBinding',
};

/** Resource types that must use legacy DELETE /delete endpoint. */
const LEGACY_DELETE_TYPES = new Set([
  'component-type',
  'workflow',
  'component-workflow',
  'trait',
]);

/** Kinds that live at the cluster scope (no namespace in the path). */
const CLUSTER_SCOPED_KINDS = new Set(['ClusterRole', 'ClusterRoleBinding']);

export class ResourceService {
  getCrdKind(nodeType: ResourceNodeType): string | undefined {
    return NODE_TYPE_TO_CRD_KIND[nodeType];
  }

  /** Deletes a resource using per-resource DELETE endpoints (new API) or legacy DELETE /delete. */
  async deleteResource(
    client: Client,
    legacyClient: LegacyClient,
    nodeType: ResourceNodeType,
    namespace: string | undefined,
    name: string,
  ): Promise<void> {
    // Legacy-only types use the generic DELETE /delete endpoint
    if (LEGACY_DELETE_TYPES.has(nodeType)) {
      return this.deleteLegacy(legacyClient, nodeType, namespace, name);
    }

    // New API per-resource DELETE endpoints
    const ns = namespace ?? '';
    switch (nodeType) {
      case 'project': {
        const { error } = await client.DELETE(
          '/api/v1/namespaces/{namespaceName}/projects/{projectName}',
          { params: { path: { namespaceName: ns, projectName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete project: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'component': {
        const { error } = await client.DELETE(
          '/api/v1/namespaces/{namespaceName}/components/{componentName}',
          { params: { path: { namespaceName: ns, componentName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete component: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'environment': {
        const { error } = await client.DELETE(
          '/api/v1/namespaces/{namespaceName}/environments/{envName}',
          { params: { path: { namespaceName: ns, envName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete environment: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'data-plane': {
        const { error } = await client.DELETE(
          '/api/v1/namespaces/{namespaceName}/dataplanes/{dpName}',
          { params: { path: { namespaceName: ns, dpName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete data plane: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'build-plane': {
        const { error } = await client.DELETE(
          '/api/v1/namespaces/{namespaceName}/buildplanes/{bpName}',
          { params: { path: { namespaceName: ns, bpName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete build plane: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'observability-plane': {
        const { error } = await client.DELETE(
          '/api/v1/namespaces/{namespaceName}/observabilityplanes/{opName}',
          { params: { path: { namespaceName: ns, opName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete observability plane: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'deployment-pipeline': {
        const { error } = await client.DELETE(
          '/api/v1/namespaces/{namespaceName}/deployment-pipelines/{pipelineName}',
          { params: { path: { namespaceName: ns, pipelineName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete deployment pipeline: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'workload': {
        const { error } = await client.DELETE(
          '/api/v1/namespaces/{namespaceName}/workloads/{workloadName}',
          { params: { path: { namespaceName: ns, workloadName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete workload: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'secret-reference': {
        const { error } = await client.DELETE(
          '/api/v1/namespaces/{namespaceName}/secret-references/{secretRefName}',
          { params: { path: { namespaceName: ns, secretRefName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete secret reference: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'component-release': {
        const { error } = await client.DELETE(
          '/api/v1/namespaces/{namespaceName}/component-releases/{releaseName}',
          { params: { path: { namespaceName: ns, releaseName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete component release: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'release-binding': {
        const { error } = await client.DELETE(
          '/api/v1/namespaces/{namespaceName}/release-bindings/{bindingName}',
          { params: { path: { namespaceName: ns, bindingName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete release binding: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'namespace-role': {
        const { error } = await client.DELETE(
          '/api/v1/namespaces/{namespaceName}/roles/{name}',
          { params: { path: { namespaceName: ns, name } } },
        );
        if (error) {
          throw new Error(`Failed to delete namespace role: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'namespace-role-binding': {
        const { error } = await client.DELETE(
          '/api/v1/namespaces/{namespaceName}/rolebindings/{name}',
          { params: { path: { namespaceName: ns, name } } },
        );
        if (error) {
          throw new Error(`Failed to delete namespace role binding: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'cluster-role': {
        const { error } = await client.DELETE(
          '/api/v1/clusterroles/{name}',
          { params: { path: { name } } },
        );
        if (error) {
          throw new Error(`Failed to delete cluster role: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'cluster-role-binding': {
        const { error } = await client.DELETE(
          '/api/v1/clusterrolebindings/{name}',
          { params: { path: { name } } },
        );
        if (error) {
          throw new Error(`Failed to delete cluster role binding: ${JSON.stringify(error)}`);
        }
        return;
      }
      default:
        throw new Error(`Delete not supported for resource type: ${nodeType}`);
    }
  }

  /** Legacy delete using generic DELETE /delete endpoint. */
  private async deleteLegacy(
    legacyClient: LegacyClient,
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

    const { error } = await legacyClient.DELETE('/delete', {
      body,
    });
    if (error) {
      throw new Error(`Failed to delete ${nodeType}: ${JSON.stringify(error)}`);
    }
  }
}

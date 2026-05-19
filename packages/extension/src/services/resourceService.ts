// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { ApiClientManager } from '../api/apiClient';
import type { ResourceNodeType } from '../treeView/types';

type Client = NonNullable<
  Awaited<ReturnType<ApiClientManager['getClient']>>
>;

/** Maps tree-view node types to their PascalCase CRD kind (used by apply command). */
const NODE_TYPE_TO_CRD_KIND: Partial<Record<ResourceNodeType, string>> = {
  'component-type': 'ComponentType',
  workflow: 'Workflow',
  trait: 'Trait',
  project: 'Project',
  component: 'Component',
  environment: 'Environment',
  'data-plane': 'DataPlane',
  'workflow-plane': 'WorkflowPlane',
  'observability-plane': 'ObservabilityPlane',
  'deployment-pipeline': 'DeploymentPipeline',
  'secret-reference': 'SecretReference',
  workload: 'Workload',
  'component-release': 'ComponentRelease',
  'release-binding': 'ReleaseBinding',
  resource: 'Resource',
  'resource-release': 'ResourceRelease',
  'resource-release-binding': 'ResourceReleaseBinding',
  'namespace-role': 'NamespaceRole',
  'namespace-role-binding': 'NamespaceRoleBinding',
  'cluster-role': 'ClusterRole',
  'cluster-role-binding': 'ClusterRoleBinding',
  // Cluster-scoped resources
  'cluster-component-type': 'ClusterComponentType',
  'cluster-workflow': 'ClusterWorkflow',
  'cluster-trait': 'ClusterTrait',
  'cluster-data-plane': 'ClusterDataPlane',
  'cluster-workflow-plane': 'ClusterWorkflowPlane',
  'cluster-observability-plane': 'ClusterObservabilityPlane',
};

/** Kinds that live at the cluster scope (no namespace in the path). */
const CLUSTER_SCOPED_KINDS = new Set([
  'ClusterRole',
  'ClusterRoleBinding',
  'ClusterComponentType',
  'ClusterWorkflow',
  'ClusterTrait',
  'ClusterDataPlane',
  'ClusterWorkflowPlane',
  'ClusterObservabilityPlane',
]);

export class ResourceService {
  getCrdKind(nodeType: ResourceNodeType): string | undefined {
    return NODE_TYPE_TO_CRD_KIND[nodeType];
  }

  isClusterScoped(nodeType: ResourceNodeType): boolean {
    const kind = NODE_TYPE_TO_CRD_KIND[nodeType];
    return kind ? CLUSTER_SCOPED_KINDS.has(kind) : false;
  }

  /** Deletes a resource using per-resource DELETE endpoints. */
  async deleteResource(
    client: Client,
    nodeType: ResourceNodeType,
    namespace: string | undefined,
    name: string,
  ): Promise<void> {
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
      case 'component-type': {
        const { error } = await client.DELETE(
          '/api/v1/namespaces/{namespaceName}/componenttypes/{ctName}',
          { params: { path: { namespaceName: ns, ctName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete component type: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'workflow': {
        const { error } = await client.DELETE(
          '/api/v1/namespaces/{namespaceName}/workflows/{workflowName}',
          { params: { path: { namespaceName: ns, workflowName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete workflow: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'trait': {
        const { error } = await client.DELETE(
          '/api/v1/namespaces/{namespaceName}/traits/{traitName}',
          { params: { path: { namespaceName: ns, traitName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete trait: ${JSON.stringify(error)}`);
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
      case 'workflow-plane': {
        const { error } = await client.DELETE(
          '/api/v1/namespaces/{namespaceName}/workflowplanes/{workflowPlaneName}',
          { params: { path: { namespaceName: ns, workflowPlaneName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete workflow plane: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'observability-plane': {
        const { error } = await client.DELETE(
          '/api/v1/namespaces/{namespaceName}/observabilityplanes/{observabilityPlaneName}',
          { params: { path: { namespaceName: ns, observabilityPlaneName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete observability plane: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'deployment-pipeline': {
        const { error } = await client.DELETE(
          '/api/v1/namespaces/{namespaceName}/deploymentpipelines/{deploymentPipelineName}',
          { params: { path: { namespaceName: ns, deploymentPipelineName: name } } },
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
          '/api/v1/namespaces/{namespaceName}/secretreferences/{secretReferenceName}',
          { params: { path: { namespaceName: ns, secretReferenceName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete secret reference: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'release-binding': {
        const { error } = await client.DELETE(
          '/api/v1/namespaces/{namespaceName}/releasebindings/{releaseBindingName}',
          { params: { path: { namespaceName: ns, releaseBindingName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete release binding: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'namespace-role': {
        const { error } = await client.DELETE(
          '/api/v1/namespaces/{namespaceName}/authzroles/{name}',
          { params: { path: { namespaceName: ns, name } } },
        );
        if (error) {
          throw new Error(`Failed to delete namespace role: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'namespace-role-binding': {
        const { error } = await client.DELETE(
          '/api/v1/namespaces/{namespaceName}/authzrolebindings/{name}',
          { params: { path: { namespaceName: ns, name } } },
        );
        if (error) {
          throw new Error(`Failed to delete namespace role binding: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'cluster-role': {
        const { error } = await client.DELETE(
          '/api/v1/clusterauthzroles/{name}',
          { params: { path: { name } } },
        );
        if (error) {
          throw new Error(`Failed to delete cluster role: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'cluster-role-binding': {
        const { error } = await client.DELETE(
          '/api/v1/clusterauthzrolebindings/{name}',
          { params: { path: { name } } },
        );
        if (error) {
          throw new Error(`Failed to delete cluster role binding: ${JSON.stringify(error)}`);
        }
        return;
      }
      // Cluster-scoped infrastructure resources
      case 'cluster-component-type': {
        const { error } = await client.DELETE(
          '/api/v1/clustercomponenttypes/{cctName}',
          { params: { path: { cctName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete cluster component type: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'cluster-workflow': {
        const { error } = await client.DELETE(
          '/api/v1/clusterworkflows/{clusterWorkflowName}',
          { params: { path: { clusterWorkflowName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete cluster workflow: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'cluster-trait': {
        const { error } = await client.DELETE(
          '/api/v1/clustertraits/{clusterTraitName}',
          { params: { path: { clusterTraitName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete cluster trait: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'cluster-data-plane': {
        const { error } = await client.DELETE(
          '/api/v1/clusterdataplanes/{cdpName}',
          { params: { path: { cdpName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete cluster data plane: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'cluster-workflow-plane': {
        const { error } = await client.DELETE(
          '/api/v1/clusterworkflowplanes/{clusterWorkflowPlaneName}',
          { params: { path: { clusterWorkflowPlaneName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete cluster workflow plane: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'cluster-observability-plane': {
        const { error } = await client.DELETE(
          '/api/v1/clusterobservabilityplanes/{clusterObservabilityPlaneName}',
          { params: { path: { clusterObservabilityPlaneName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete cluster observability plane: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'resource': {
        const { error } = await client.DELETE(
          '/api/v1/namespaces/{namespaceName}/resources/{resourceName}',
          { params: { path: { namespaceName: ns, resourceName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete resource: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'resource-release': {
        const { error } = await client.DELETE(
          '/api/v1/namespaces/{namespaceName}/resourcereleases/{resourceReleaseName}',
          { params: { path: { namespaceName: ns, resourceReleaseName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete resource release: ${JSON.stringify(error)}`);
        }
        return;
      }
      case 'resource-release-binding': {
        const { error } = await client.DELETE(
          '/api/v1/namespaces/{namespaceName}/resourcereleasebindings/{resourceReleaseBindingName}',
          { params: { path: { namespaceName: ns, resourceReleaseBindingName: name } } },
        );
        if (error) {
          throw new Error(`Failed to delete resource release binding: ${JSON.stringify(error)}`);
        }
        return;
      }
      default:
        throw new Error(`Delete not supported for resource type: ${nodeType}`);
    }
  }
}

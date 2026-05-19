// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { ApiClientManager } from '../api/apiClient';

type Client = NonNullable<
  Awaited<ReturnType<ApiClientManager['getClient']>>
>;

/**
 * Maps CRD kinds to their API PUT endpoint.
 * Returns { path, params, body } for client.PUT() call.
 */
export function buildPutRequest(
  kind: string,
  name: string,
  ns: string,
  body: Record<string, unknown>,
): {
  path: string;
  params: { path: Record<string, string> };
  body: unknown;
} | null {
  // Strip apiVersion and kind — API expects { metadata, spec }
  const { apiVersion: _a, kind: _k, ...rest } = body;

  switch (kind) {
    case 'Project':
      return {
        path: '/api/v1/namespaces/{namespaceName}/projects/{projectName}',
        params: { path: { namespaceName: ns, projectName: name } },
        body: rest,
      };
    case 'Component':
      return {
        path: '/api/v1/namespaces/{namespaceName}/components/{componentName}',
        params: { path: { namespaceName: ns, componentName: name } },
        body: rest,
      };
    case 'Environment':
      return {
        path: '/api/v1/namespaces/{namespaceName}/environments/{envName}',
        params: { path: { namespaceName: ns, envName: name } },
        body: rest,
      };
    case 'DataPlane':
      return {
        path: '/api/v1/namespaces/{namespaceName}/dataplanes/{dpName}',
        params: { path: { namespaceName: ns, dpName: name } },
        body: rest,
      };
    case 'WorkflowPlane':
      return {
        path: '/api/v1/namespaces/{namespaceName}/workflowplanes/{workflowPlaneName}',
        params: { path: { namespaceName: ns, workflowPlaneName: name } },
        body: rest,
      };
    case 'ObservabilityPlane':
      return {
        path: '/api/v1/namespaces/{namespaceName}/observabilityplanes/{observabilityPlaneName}',
        params: { path: { namespaceName: ns, observabilityPlaneName: name } },
        body: rest,
      };
    case 'DeploymentPipeline':
      return {
        path: '/api/v1/namespaces/{namespaceName}/deploymentpipelines/{deploymentPipelineName}',
        params: { path: { namespaceName: ns, deploymentPipelineName: name } },
        body: rest,
      };
    case 'Workload':
      return {
        path: '/api/v1/namespaces/{namespaceName}/workloads/{workloadName}',
        params: { path: { namespaceName: ns, workloadName: name } },
        body: rest,
      };
    case 'SecretReference':
      return {
        path: '/api/v1/namespaces/{namespaceName}/secretreferences/{secretReferenceName}',
        params: { path: { namespaceName: ns, secretReferenceName: name } },
        body: rest,
      };
    case 'ReleaseBinding':
      return {
        path: '/api/v1/namespaces/{namespaceName}/releasebindings/{releaseBindingName}',
        params: { path: { namespaceName: ns, releaseBindingName: name } },
        body: rest,
      };
    case 'Resource':
      return {
        path: '/api/v1/namespaces/{namespaceName}/resources/{resourceName}',
        params: { path: { namespaceName: ns, resourceName: name } },
        body: rest,
      };
    case 'ResourceReleaseBinding':
      return {
        path: '/api/v1/namespaces/{namespaceName}/resourcereleasebindings/{resourceReleaseBindingName}',
        params: { path: { namespaceName: ns, resourceReleaseBindingName: name } },
        body: rest,
      };
    case 'Workflow':
      return {
        path: '/api/v1/namespaces/{namespaceName}/workflows/{workflowName}',
        params: { path: { namespaceName: ns, workflowName: name } },
        body: rest,
      };
    case 'ComponentType':
      return {
        path: '/api/v1/namespaces/{namespaceName}/componenttypes/{ctName}',
        params: { path: { namespaceName: ns, ctName: name } },
        body: rest,
      };
    case 'Trait':
      return {
        path: '/api/v1/namespaces/{namespaceName}/traits/{traitName}',
        params: { path: { namespaceName: ns, traitName: name } },
        body: rest,
      };
    case 'AuthzRole':
      return {
        path: '/api/v1/namespaces/{namespaceName}/authzroles/{name}',
        params: { path: { namespaceName: ns, name } },
        body: rest,
      };
    case 'AuthzRoleBinding':
      return {
        path: '/api/v1/namespaces/{namespaceName}/authzrolebindings/{name}',
        params: { path: { namespaceName: ns, name } },
        body: rest,
      };
    case 'ClusterAuthzRole':
      return {
        path: '/api/v1/clusterauthzroles/{name}',
        params: { path: { name } },
        body: rest,
      };
    case 'ClusterAuthzRoleBinding':
      return {
        path: '/api/v1/clusterauthzrolebindings/{name}',
        params: { path: { name } },
        body: rest,
      };
    case 'ClusterComponentType':
      return {
        path: '/api/v1/clustercomponenttypes/{cctName}',
        params: { path: { cctName: name } },
        body: rest,
      };
    case 'ClusterWorkflow':
      return {
        path: '/api/v1/clusterworkflows/{clusterWorkflowName}',
        params: { path: { clusterWorkflowName: name } },
        body: rest,
      };
    case 'ClusterTrait':
      return {
        path: '/api/v1/clustertraits/{clusterTraitName}',
        params: { path: { clusterTraitName: name } },
        body: rest,
      };
    case 'ClusterDataPlane':
      return {
        path: '/api/v1/clusterdataplanes/{cdpName}',
        params: { path: { cdpName: name } },
        body: rest,
      };
    case 'ClusterWorkflowPlane':
      return {
        path: '/api/v1/clusterworkflowplanes/{clusterWorkflowPlaneName}',
        params: { path: { clusterWorkflowPlaneName: name } },
        body: rest,
      };
    case 'ClusterObservabilityPlane':
      return {
        path: '/api/v1/clusterobservabilityplanes/{clusterObservabilityPlaneName}',
        params: { path: { clusterObservabilityPlaneName: name } },
        body: rest,
      };
    default:
      return null;
  }
}

/**
 * Maps CRD kinds to their API POST (create) endpoint.
 * Targets the collection endpoint (no resource name in path).
 */
export function buildPostRequest(
  kind: string,
  ns: string,
  body: Record<string, unknown>,
): {
  path: string;
  params: { path: Record<string, string> };
  body: unknown;
} | null {
  const { apiVersion: _a, kind: _k, ...rest } = body;

  switch (kind) {
    case 'Project':
      return { path: '/api/v1/namespaces/{namespaceName}/projects', params: { path: { namespaceName: ns } }, body: rest };
    case 'Component':
      return { path: '/api/v1/namespaces/{namespaceName}/components', params: { path: { namespaceName: ns } }, body: rest };
    case 'Environment':
      return { path: '/api/v1/namespaces/{namespaceName}/environments', params: { path: { namespaceName: ns } }, body: rest };
    case 'DataPlane':
      return { path: '/api/v1/namespaces/{namespaceName}/dataplanes', params: { path: { namespaceName: ns } }, body: rest };
    case 'WorkflowPlane':
      return { path: '/api/v1/namespaces/{namespaceName}/workflowplanes', params: { path: { namespaceName: ns } }, body: rest };
    case 'ObservabilityPlane':
      return { path: '/api/v1/namespaces/{namespaceName}/observabilityplanes', params: { path: { namespaceName: ns } }, body: rest };
    case 'DeploymentPipeline':
      return { path: '/api/v1/namespaces/{namespaceName}/deploymentpipelines', params: { path: { namespaceName: ns } }, body: rest };
    case 'Workload':
      return { path: '/api/v1/namespaces/{namespaceName}/workloads', params: { path: { namespaceName: ns } }, body: rest };
    case 'SecretReference':
      return { path: '/api/v1/namespaces/{namespaceName}/secretreferences', params: { path: { namespaceName: ns } }, body: rest };
    case 'Workflow':
      return { path: '/api/v1/namespaces/{namespaceName}/workflows', params: { path: { namespaceName: ns } }, body: rest };
    case 'ComponentType':
      return { path: '/api/v1/namespaces/{namespaceName}/componenttypes', params: { path: { namespaceName: ns } }, body: rest };
    case 'Trait':
      return { path: '/api/v1/namespaces/{namespaceName}/traits', params: { path: { namespaceName: ns } }, body: rest };
    case 'ReleaseBinding':
      return { path: '/api/v1/namespaces/{namespaceName}/releasebindings', params: { path: { namespaceName: ns } }, body: rest };
    case 'AuthzRole':
      return { path: '/api/v1/namespaces/{namespaceName}/authzroles', params: { path: { namespaceName: ns } }, body: rest };
    case 'AuthzRoleBinding':
      return { path: '/api/v1/namespaces/{namespaceName}/authzrolebindings', params: { path: { namespaceName: ns } }, body: rest };
    case 'WorkflowRun':
      return { path: '/api/v1/namespaces/{namespaceName}/workflowruns', params: { path: { namespaceName: ns } }, body: rest };
    // Cluster-scoped
    case 'ClusterComponentType':
      return { path: '/api/v1/clustercomponenttypes', params: { path: {} }, body: rest };
    case 'ClusterWorkflow':
      return { path: '/api/v1/clusterworkflows', params: { path: {} }, body: rest };
    case 'ClusterTrait':
      return { path: '/api/v1/clustertraits', params: { path: {} }, body: rest };
    case 'ClusterDataPlane':
      return { path: '/api/v1/clusterdataplanes', params: { path: {} }, body: rest };
    case 'ClusterWorkflowPlane':
      return { path: '/api/v1/clusterworkflowplanes', params: { path: {} }, body: rest };
    case 'ClusterObservabilityPlane':
      return { path: '/api/v1/clusterobservabilityplanes', params: { path: {} }, body: rest };
    case 'ClusterAuthzRole':
      return { path: '/api/v1/clusterauthzroles', params: { path: {} }, body: rest };
    case 'ClusterAuthzRoleBinding':
      return { path: '/api/v1/clusterauthzrolebindings', params: { path: {} }, body: rest };
    default:
      return null;
  }
}

/**
 * Fetches a single resource from the API by type, namespace, and name.
 * Returns the raw API response object.
 */
export async function fetchResource(
  client: Client,
  type: string,
  ns: string | null,
  name: string | null,
): Promise<unknown> {
  switch (type) {
    case 'namespace': {
      if (!ns) throw new Error('Namespace name required');
      const { data, error } = await client.GET(
        '/api/v1/namespaces/{namespaceName}',
        { params: { path: { namespaceName: ns } } },
      );
      if (error) throw new Error(`Failed to fetch namespace: ${JSON.stringify(error)}`);
      return data;
    }
    case 'component-type': {
      if (!ns || !name) throw new Error('Namespace and name required for component type');
      const { data, error } = await client.GET(
        '/api/v1/namespaces/{namespaceName}/componenttypes/{ctName}',
        { params: { path: { namespaceName: ns, ctName: name } } },
      );
      if (error) throw new Error(`Failed to fetch component type: ${JSON.stringify(error)}`);
      return data;
    }
    case 'workflow': {
      if (!ns || !name) throw new Error('Namespace and name required for workflow');
      const { data, error } = await client.GET(
        '/api/v1/namespaces/{namespaceName}/workflows/{workflowName}',
        { params: { path: { namespaceName: ns, workflowName: name } } },
      );
      if (error) throw new Error(`Failed to fetch workflow: ${JSON.stringify(error)}`);
      return data;
    }
    case 'trait': {
      if (!ns || !name) throw new Error('Namespace and name required for trait');
      const { data, error } = await client.GET(
        '/api/v1/namespaces/{namespaceName}/traits/{traitName}',
        { params: { path: { namespaceName: ns, traitName: name } } },
      );
      if (error) throw new Error(`Failed to fetch trait: ${JSON.stringify(error)}`);
      return data;
    }
    case 'project': {
      if (!ns || !name) throw new Error('Namespace and name required for project');
      const { data, error } = await client.GET(
        '/api/v1/namespaces/{namespaceName}/projects/{projectName}',
        { params: { path: { namespaceName: ns, projectName: name } } },
      );
      if (error) throw new Error(`Failed to fetch project: ${JSON.stringify(error)}`);
      return data;
    }
    case 'component': {
      if (!ns || !name) throw new Error('Namespace and name required for component');
      const { data, error } = await client.GET(
        '/api/v1/namespaces/{namespaceName}/components/{componentName}',
        { params: { path: { namespaceName: ns, componentName: name } } },
      );
      if (error) throw new Error(`Failed to fetch component: ${JSON.stringify(error)}`);
      return data;
    }
    case 'environment': {
      if (!ns || !name) throw new Error('Namespace and name required for environment');
      const { data, error } = await client.GET(
        '/api/v1/namespaces/{namespaceName}/environments/{envName}',
        { params: { path: { namespaceName: ns, envName: name } } },
      );
      if (error) throw new Error(`Failed to fetch environment: ${JSON.stringify(error)}`);
      return data;
    }
    case 'data-plane': {
      if (!ns || !name) throw new Error('Namespace and name required for data plane');
      const { data, error } = await client.GET(
        '/api/v1/namespaces/{namespaceName}/dataplanes/{dpName}',
        { params: { path: { namespaceName: ns, dpName: name } } },
      );
      if (error) throw new Error(`Failed to fetch data plane: ${JSON.stringify(error)}`);
      return data;
    }
    case 'workflow-plane': {
      if (!ns || !name) throw new Error('Namespace and name required for workflow plane');
      const { data, error } = await client.GET(
        '/api/v1/namespaces/{namespaceName}/workflowplanes/{workflowPlaneName}',
        { params: { path: { namespaceName: ns, workflowPlaneName: name } } },
      );
      if (error) throw new Error(`Failed to fetch workflow plane: ${JSON.stringify(error)}`);
      return data;
    }
    case 'observability-plane': {
      if (!ns || !name) throw new Error('Namespace and name required for observability plane');
      const { data, error } = await client.GET(
        '/api/v1/namespaces/{namespaceName}/observabilityplanes/{observabilityPlaneName}',
        { params: { path: { namespaceName: ns, observabilityPlaneName: name } } },
      );
      if (error) throw new Error(`Failed to fetch observability plane: ${JSON.stringify(error)}`);
      return data;
    }
    case 'deployment-pipeline': {
      if (!ns || !name) throw new Error('Namespace and name required for deployment pipeline');
      const { data, error } = await client.GET(
        '/api/v1/namespaces/{namespaceName}/deploymentpipelines/{deploymentPipelineName}',
        { params: { path: { namespaceName: ns, deploymentPipelineName: name } } },
      );
      if (error) throw new Error(`Failed to fetch deployment pipeline: ${JSON.stringify(error)}`);
      return data;
    }
    case 'workload': {
      if (!ns || !name) throw new Error('Namespace and name required for workload');
      const { data, error } = await client.GET(
        '/api/v1/namespaces/{namespaceName}/workloads/{workloadName}',
        { params: { path: { namespaceName: ns, workloadName: name } } },
      );
      if (error) throw new Error(`Failed to fetch workload: ${JSON.stringify(error)}`);
      return data;
    }
    case 'secret-reference': {
      if (!ns || !name) throw new Error('Namespace and name required for secret reference');
      const { data, error } = await client.GET(
        '/api/v1/namespaces/{namespaceName}/secretreferences/{secretReferenceName}',
        { params: { path: { namespaceName: ns, secretReferenceName: name } } },
      );
      if (error) throw new Error(`Failed to fetch secret reference: ${JSON.stringify(error)}`);
      return data;
    }
    case 'workflow-run': {
      if (!ns || !name) throw new Error('Namespace and name required for workflow run');
      const { data, error } = await client.GET(
        '/api/v1/namespaces/{namespaceName}/workflowruns/{runName}',
        { params: { path: { namespaceName: ns, runName: name } } },
      );
      if (error) throw new Error(`Failed to fetch workflow run: ${JSON.stringify(error)}`);
      return data;
    }
    case 'component-release': {
      if (!ns || !name) throw new Error('Namespace and name required for component release');
      const { data, error } = await client.GET(
        '/api/v1/namespaces/{namespaceName}/componentreleases/{componentReleaseName}',
        { params: { path: { namespaceName: ns, componentReleaseName: name } } },
      );
      if (error) throw new Error(`Failed to fetch component release: ${JSON.stringify(error)}`);
      return data;
    }
    case 'release-binding': {
      if (!ns || !name) throw new Error('Namespace and name required for release binding');
      const { data, error } = await client.GET(
        '/api/v1/namespaces/{namespaceName}/releasebindings/{releaseBindingName}',
        { params: { path: { namespaceName: ns, releaseBindingName: name } } },
      );
      if (error) throw new Error(`Failed to fetch release binding: ${JSON.stringify(error)}`);
      return data;
    }
    case 'resource': {
      if (!ns || !name) throw new Error('Namespace and name required for resource');
      const { data, error } = await client.GET(
        '/api/v1/namespaces/{namespaceName}/resources/{resourceName}',
        { params: { path: { namespaceName: ns, resourceName: name } } },
      );
      if (error) throw new Error(`Failed to fetch resource: ${JSON.stringify(error)}`);
      return data;
    }
    case 'resource-release': {
      if (!ns || !name) throw new Error('Namespace and name required for resource release');
      const { data, error } = await client.GET(
        '/api/v1/namespaces/{namespaceName}/resourcereleases/{resourceReleaseName}',
        { params: { path: { namespaceName: ns, resourceReleaseName: name } } },
      );
      if (error) throw new Error(`Failed to fetch resource release: ${JSON.stringify(error)}`);
      return data;
    }
    case 'resource-release-binding': {
      if (!ns || !name) throw new Error('Namespace and name required for resource release binding');
      const { data, error } = await client.GET(
        '/api/v1/namespaces/{namespaceName}/resourcereleasebindings/{resourceReleaseBindingName}',
        { params: { path: { namespaceName: ns, resourceReleaseBindingName: name } } },
      );
      if (error) throw new Error(`Failed to fetch resource release binding: ${JSON.stringify(error)}`);
      return data;
    }
    case 'namespace-role': {
      if (!ns || !name) throw new Error('Namespace and name required for namespace role');
      const { data, error } = await client.GET(
        '/api/v1/namespaces/{namespaceName}/authzroles/{name}',
        { params: { path: { namespaceName: ns, name } } },
      );
      if (error) throw new Error(`Failed to fetch namespace role: ${JSON.stringify(error)}`);
      return data;
    }
    case 'namespace-role-binding': {
      if (!ns || !name) throw new Error('Namespace and name required for namespace role binding');
      const { data, error } = await client.GET(
        '/api/v1/namespaces/{namespaceName}/authzrolebindings/{name}',
        { params: { path: { namespaceName: ns, name } } },
      );
      if (error) throw new Error(`Failed to fetch namespace role binding: ${JSON.stringify(error)}`);
      return data;
    }
    case 'cluster-role': {
      if (!name) throw new Error('Name required for cluster role');
      const { data, error } = await client.GET(
        '/api/v1/clusterauthzroles/{name}',
        { params: { path: { name } } },
      );
      if (error) throw new Error(`Failed to fetch cluster role: ${JSON.stringify(error)}`);
      return data;
    }
    case 'cluster-role-binding': {
      if (!name) throw new Error('Name required for cluster role binding');
      const { data, error } = await client.GET(
        '/api/v1/clusterauthzrolebindings/{name}',
        { params: { path: { name } } },
      );
      if (error) throw new Error(`Failed to fetch cluster role binding: ${JSON.stringify(error)}`);
      return data;
    }
    case 'cluster-component-type': {
      if (!name) throw new Error('Name required for cluster component type');
      const { data, error } = await client.GET(
        '/api/v1/clustercomponenttypes/{cctName}',
        { params: { path: { cctName: name } } },
      );
      if (error) throw new Error(`Failed to fetch cluster component type: ${JSON.stringify(error)}`);
      return data;
    }
    case 'cluster-workflow': {
      if (!name) throw new Error('Name required for cluster workflow');
      const { data, error } = await client.GET(
        '/api/v1/clusterworkflows/{clusterWorkflowName}',
        { params: { path: { clusterWorkflowName: name } } },
      );
      if (error) throw new Error(`Failed to fetch cluster workflow: ${JSON.stringify(error)}`);
      return data;
    }
    case 'cluster-trait': {
      if (!name) throw new Error('Name required for cluster trait');
      const { data, error } = await client.GET(
        '/api/v1/clustertraits/{clusterTraitName}',
        { params: { path: { clusterTraitName: name } } },
      );
      if (error) throw new Error(`Failed to fetch cluster trait: ${JSON.stringify(error)}`);
      return data;
    }
    case 'cluster-data-plane': {
      if (!name) throw new Error('Name required for cluster data plane');
      const { data, error } = await client.GET(
        '/api/v1/clusterdataplanes/{cdpName}',
        { params: { path: { cdpName: name } } },
      );
      if (error) throw new Error(`Failed to fetch cluster data plane: ${JSON.stringify(error)}`);
      return data;
    }
    case 'cluster-workflow-plane': {
      if (!name) throw new Error('Name required for cluster workflow plane');
      const { data, error } = await client.GET(
        '/api/v1/clusterworkflowplanes/{clusterWorkflowPlaneName}',
        { params: { path: { clusterWorkflowPlaneName: name } } },
      );
      if (error) throw new Error(`Failed to fetch cluster workflow plane: ${JSON.stringify(error)}`);
      return data;
    }
    case 'cluster-observability-plane': {
      if (!name) throw new Error('Name required for cluster observability plane');
      const { data, error } = await client.GET(
        '/api/v1/clusterobservabilityplanes/{clusterObservabilityPlaneName}',
        { params: { path: { clusterObservabilityPlaneName: name } } },
      );
      if (error) throw new Error(`Failed to fetch cluster observability plane: ${JSON.stringify(error)}`);
      return data;
    }
    default:
      throw new Error(`Unknown resource type: ${type}`);
  }
}

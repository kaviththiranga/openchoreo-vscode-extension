// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { OpenChoreoAPI } from '@openchoreo/openchoreo-client-node';
import type { ResourceNodeType } from '../treeView/types';

/** Any route of the OpenChoreo API — typos and removed routes fail type-checking. */
export type ApiPath = keyof OpenChoreoAPI.paths;

/**
 * Everything the extension needs to know about one OpenChoreo resource kind
 * served by the OpenChoreo API. Single source of truth for API routes, tree
 * node mapping, scope, and which operations the tree offers.
 */
export interface KindSpec {
  /** CRD kind, e.g. "ComponentType". */
  kind: string;
  /** Human-readable name for messages. */
  label: string;
  scope: 'namespace' | 'cluster';
  /** Tree node type for kinds shown in the explorers. */
  nodeType?: ResourceNodeType;
  /** Collection route (list / create). */
  collectionPath: ApiPath;
  /** Single-resource route (get / update / delete). */
  itemPath: ApiPath;
  /** Path parameter in `itemPath` that carries the resource name. */
  nameParam: string;
  /** JSON Schema of the resource's `parameters`, when the API serves one. */
  schemaPath?: ApiPath;
  /** Operations the extension offers (subset of what the API allows). */
  create: boolean;
  update: boolean;
  delete: boolean;
  /** Authz action that gates delete in the UI, when the server defines one. */
  deleteAction?: string;
  /** First OpenChoreo [major, minor] that serves this kind. */
  since?: [number, number];
}

/**
 * Generated from openapi/openchoreo-api.yaml at OpenChoreo v1.3.3, then
 * annotated: run history and immutable releases (WorkflowRun,
 * ComponentRelease, ProjectRelease) are read-only in the tree.
 */
export const KIND_REGISTRY: readonly KindSpec[] = [
  {
    kind: 'AuthzRole',
    label: 'Authz Role',
    scope: 'namespace',
    nodeType: 'namespace-role',
    collectionPath: '/api/v1/namespaces/{namespaceName}/authzroles',
    itemPath: '/api/v1/namespaces/{namespaceName}/authzroles/{name}',
    nameParam: 'name',
    create: true,
    update: true,
    delete: true,
    deleteAction: 'authzrole:delete',
  },
  {
    kind: 'AuthzRoleBinding',
    label: 'Authz Role Binding',
    scope: 'namespace',
    nodeType: 'namespace-role-binding',
    collectionPath: '/api/v1/namespaces/{namespaceName}/authzrolebindings',
    itemPath: '/api/v1/namespaces/{namespaceName}/authzrolebindings/{name}',
    nameParam: 'name',
    create: true,
    update: true,
    delete: true,
    deleteAction: 'authzrolebinding:delete',
  },
  {
    kind: 'Component',
    label: 'Component',
    scope: 'namespace',
    nodeType: 'component',
    collectionPath: '/api/v1/namespaces/{namespaceName}/components',
    itemPath: '/api/v1/namespaces/{namespaceName}/components/{componentName}',
    nameParam: 'componentName',
    schemaPath: '/api/v1/namespaces/{namespaceName}/components/{componentName}/schema',
    create: true,
    update: true,
    delete: true,
    deleteAction: 'component:delete',
  },
  {
    kind: 'ComponentRelease',
    label: 'Component Release',
    scope: 'namespace',
    nodeType: 'component-release',
    collectionPath: '/api/v1/namespaces/{namespaceName}/componentreleases',
    itemPath: '/api/v1/namespaces/{namespaceName}/componentreleases/{componentReleaseName}',
    nameParam: 'componentReleaseName',
    create: true,
    update: false,
    delete: false,
  },
  {
    kind: 'ComponentType',
    label: 'Component Type',
    scope: 'namespace',
    nodeType: 'component-type',
    collectionPath: '/api/v1/namespaces/{namespaceName}/componenttypes',
    itemPath: '/api/v1/namespaces/{namespaceName}/componenttypes/{ctName}',
    nameParam: 'ctName',
    schemaPath: '/api/v1/namespaces/{namespaceName}/componenttypes/{ctName}/schema',
    create: true,
    update: true,
    delete: true,
    deleteAction: 'componenttype:delete',
  },
  {
    kind: 'DataPlane',
    label: 'Data Plane',
    scope: 'namespace',
    nodeType: 'data-plane',
    collectionPath: '/api/v1/namespaces/{namespaceName}/dataplanes',
    itemPath: '/api/v1/namespaces/{namespaceName}/dataplanes/{dpName}',
    nameParam: 'dpName',
    create: true,
    update: true,
    delete: true,
  },
  {
    kind: 'DeploymentPipeline',
    label: 'Deployment Pipeline',
    scope: 'namespace',
    nodeType: 'deployment-pipeline',
    collectionPath: '/api/v1/namespaces/{namespaceName}/deploymentpipelines',
    itemPath: '/api/v1/namespaces/{namespaceName}/deploymentpipelines/{deploymentPipelineName}',
    nameParam: 'deploymentPipelineName',
    create: true,
    update: true,
    delete: true,
  },
  {
    kind: 'Environment',
    label: 'Environment',
    scope: 'namespace',
    nodeType: 'environment',
    collectionPath: '/api/v1/namespaces/{namespaceName}/environments',
    itemPath: '/api/v1/namespaces/{namespaceName}/environments/{envName}',
    nameParam: 'envName',
    create: true,
    update: true,
    delete: true,
  },
  {
    kind: 'ObservabilityAlertsNotificationChannel',
    label: 'Observability Alerts Notification Channel',
    scope: 'namespace',
    collectionPath: '/api/v1/namespaces/{namespaceName}/observabilityalertsnotificationchannels',
    itemPath: '/api/v1/namespaces/{namespaceName}/observabilityalertsnotificationchannels/{observabilityAlertsNotificationChannelName}',
    nameParam: 'observabilityAlertsNotificationChannelName',
    create: true,
    update: true,
    delete: true,
  },
  {
    kind: 'ObservabilityPlane',
    label: 'Observability Plane',
    scope: 'namespace',
    nodeType: 'observability-plane',
    collectionPath: '/api/v1/namespaces/{namespaceName}/observabilityplanes',
    itemPath: '/api/v1/namespaces/{namespaceName}/observabilityplanes/{observabilityPlaneName}',
    nameParam: 'observabilityPlaneName',
    create: true,
    update: true,
    delete: true,
  },
  {
    kind: 'Project',
    label: 'Project',
    scope: 'namespace',
    nodeType: 'project',
    collectionPath: '/api/v1/namespaces/{namespaceName}/projects',
    itemPath: '/api/v1/namespaces/{namespaceName}/projects/{projectName}',
    nameParam: 'projectName',
    create: true,
    update: true,
    delete: true,
    deleteAction: 'project:delete',
  },
  {
    kind: 'ProjectRelease',
    label: 'Project Release',
    scope: 'namespace',
    collectionPath: '/api/v1/namespaces/{namespaceName}/projectreleases',
    itemPath: '/api/v1/namespaces/{namespaceName}/projectreleases/{projectReleaseName}',
    nameParam: 'projectReleaseName',
    create: true,
    update: false,
    delete: false,
    since: [1, 3],
  },
  {
    kind: 'ProjectReleaseBinding',
    label: 'Project Release Binding',
    scope: 'namespace',
    nodeType: 'project-release-binding',
    collectionPath: '/api/v1/namespaces/{namespaceName}/projectreleasebindings',
    itemPath: '/api/v1/namespaces/{namespaceName}/projectreleasebindings/{projectReleaseBindingName}',
    nameParam: 'projectReleaseBindingName',
    create: true,
    update: true,
    delete: true,
    since: [1, 3],
  },
  {
    kind: 'ProjectType',
    label: 'Project Type',
    scope: 'namespace',
    nodeType: 'project-type',
    collectionPath: '/api/v1/namespaces/{namespaceName}/projecttypes',
    itemPath: '/api/v1/namespaces/{namespaceName}/projecttypes/{ptName}',
    nameParam: 'ptName',
    schemaPath: '/api/v1/namespaces/{namespaceName}/projecttypes/{ptName}/schema',
    create: true,
    update: true,
    delete: true,
    since: [1, 3],
  },
  {
    kind: 'ReleaseBinding',
    label: 'Release Binding',
    scope: 'namespace',
    nodeType: 'release-binding',
    collectionPath: '/api/v1/namespaces/{namespaceName}/releasebindings',
    itemPath: '/api/v1/namespaces/{namespaceName}/releasebindings/{releaseBindingName}',
    nameParam: 'releaseBindingName',
    create: true,
    update: true,
    delete: true,
  },
  {
    kind: 'Resource',
    label: 'Resource',
    scope: 'namespace',
    nodeType: 'resource',
    collectionPath: '/api/v1/namespaces/{namespaceName}/resources',
    itemPath: '/api/v1/namespaces/{namespaceName}/resources/{resourceName}',
    nameParam: 'resourceName',
    create: true,
    update: true,
    delete: true,
  },
  {
    kind: 'ResourceRelease',
    label: 'Resource Release',
    scope: 'namespace',
    nodeType: 'resource-release',
    collectionPath: '/api/v1/namespaces/{namespaceName}/resourcereleases',
    itemPath: '/api/v1/namespaces/{namespaceName}/resourcereleases/{resourceReleaseName}',
    nameParam: 'resourceReleaseName',
    create: true,
    update: false,
    delete: true,
  },
  {
    kind: 'ResourceReleaseBinding',
    label: 'Resource Release Binding',
    scope: 'namespace',
    nodeType: 'resource-release-binding',
    collectionPath: '/api/v1/namespaces/{namespaceName}/resourcereleasebindings',
    itemPath: '/api/v1/namespaces/{namespaceName}/resourcereleasebindings/{resourceReleaseBindingName}',
    nameParam: 'resourceReleaseBindingName',
    create: true,
    update: true,
    delete: true,
  },
  {
    kind: 'ResourceType',
    label: 'Resource Type',
    scope: 'namespace',
    nodeType: 'resource-type',
    collectionPath: '/api/v1/namespaces/{namespaceName}/resourcetypes',
    itemPath: '/api/v1/namespaces/{namespaceName}/resourcetypes/{rtName}',
    nameParam: 'rtName',
    schemaPath: '/api/v1/namespaces/{namespaceName}/resourcetypes/{rtName}/schema',
    create: true,
    update: true,
    delete: true,
  },
  {
    kind: 'SecretReference',
    label: 'Secret Reference',
    scope: 'namespace',
    nodeType: 'secret-reference',
    collectionPath: '/api/v1/namespaces/{namespaceName}/secretreferences',
    itemPath: '/api/v1/namespaces/{namespaceName}/secretreferences/{secretReferenceName}',
    nameParam: 'secretReferenceName',
    create: true,
    update: true,
    delete: true,
  },
  {
    kind: 'Trait',
    label: 'Trait',
    scope: 'namespace',
    nodeType: 'trait',
    collectionPath: '/api/v1/namespaces/{namespaceName}/traits',
    itemPath: '/api/v1/namespaces/{namespaceName}/traits/{traitName}',
    nameParam: 'traitName',
    schemaPath: '/api/v1/namespaces/{namespaceName}/traits/{traitName}/schema',
    create: true,
    update: true,
    delete: true,
    deleteAction: 'trait:delete',
  },
  {
    kind: 'Workflow',
    label: 'Workflow',
    scope: 'namespace',
    nodeType: 'workflow',
    collectionPath: '/api/v1/namespaces/{namespaceName}/workflows',
    itemPath: '/api/v1/namespaces/{namespaceName}/workflows/{workflowName}',
    nameParam: 'workflowName',
    schemaPath: '/api/v1/namespaces/{namespaceName}/workflows/{workflowName}/schema',
    create: true,
    update: true,
    delete: true,
    deleteAction: 'workflow:delete',
  },
  {
    kind: 'WorkflowPlane',
    label: 'Workflow Plane',
    scope: 'namespace',
    nodeType: 'workflow-plane',
    collectionPath: '/api/v1/namespaces/{namespaceName}/workflowplanes',
    itemPath: '/api/v1/namespaces/{namespaceName}/workflowplanes/{workflowPlaneName}',
    nameParam: 'workflowPlaneName',
    create: true,
    update: true,
    delete: true,
  },
  {
    kind: 'WorkflowRun',
    label: 'Workflow Run',
    scope: 'namespace',
    nodeType: 'workflow-run',
    collectionPath: '/api/v1/namespaces/{namespaceName}/workflowruns',
    itemPath: '/api/v1/namespaces/{namespaceName}/workflowruns/{runName}',
    nameParam: 'runName',
    create: true,
    update: false,
    delete: false,
  },
  {
    kind: 'Workload',
    label: 'Workload',
    scope: 'namespace',
    nodeType: 'workload',
    collectionPath: '/api/v1/namespaces/{namespaceName}/workloads',
    itemPath: '/api/v1/namespaces/{namespaceName}/workloads/{workloadName}',
    nameParam: 'workloadName',
    create: true,
    update: true,
    delete: true,
  },
  {
    kind: 'ClusterAuthzRole',
    label: 'Cluster Authz Role',
    scope: 'cluster',
    nodeType: 'cluster-role',
    collectionPath: '/api/v1/clusterauthzroles',
    itemPath: '/api/v1/clusterauthzroles/{name}',
    nameParam: 'name',
    create: true,
    update: true,
    delete: true,
    deleteAction: 'clusterauthzrole:delete',
  },
  {
    kind: 'ClusterAuthzRoleBinding',
    label: 'Cluster Authz Role Binding',
    scope: 'cluster',
    nodeType: 'cluster-role-binding',
    collectionPath: '/api/v1/clusterauthzrolebindings',
    itemPath: '/api/v1/clusterauthzrolebindings/{name}',
    nameParam: 'name',
    create: true,
    update: true,
    delete: true,
    deleteAction: 'clusterauthzrolebinding:delete',
  },
  {
    kind: 'ClusterComponentType',
    label: 'Cluster Component Type',
    scope: 'cluster',
    nodeType: 'cluster-component-type',
    collectionPath: '/api/v1/clustercomponenttypes',
    itemPath: '/api/v1/clustercomponenttypes/{cctName}',
    nameParam: 'cctName',
    schemaPath: '/api/v1/clustercomponenttypes/{cctName}/schema',
    create: true,
    update: true,
    delete: true,
  },
  {
    kind: 'ClusterDataPlane',
    label: 'Cluster Data Plane',
    scope: 'cluster',
    nodeType: 'cluster-data-plane',
    collectionPath: '/api/v1/clusterdataplanes',
    itemPath: '/api/v1/clusterdataplanes/{cdpName}',
    nameParam: 'cdpName',
    create: true,
    update: true,
    delete: true,
  },
  {
    kind: 'ClusterObservabilityPlane',
    label: 'Cluster Observability Plane',
    scope: 'cluster',
    nodeType: 'cluster-observability-plane',
    collectionPath: '/api/v1/clusterobservabilityplanes',
    itemPath: '/api/v1/clusterobservabilityplanes/{clusterObservabilityPlaneName}',
    nameParam: 'clusterObservabilityPlaneName',
    create: true,
    update: true,
    delete: true,
  },
  {
    kind: 'ClusterProjectType',
    label: 'Cluster Project Type',
    scope: 'cluster',
    nodeType: 'cluster-project-type',
    collectionPath: '/api/v1/clusterprojecttypes',
    itemPath: '/api/v1/clusterprojecttypes/{cptName}',
    nameParam: 'cptName',
    schemaPath: '/api/v1/clusterprojecttypes/{cptName}/schema',
    create: true,
    update: true,
    delete: true,
    since: [1, 3],
  },
  {
    kind: 'ClusterResourceType',
    label: 'Cluster Resource Type',
    scope: 'cluster',
    nodeType: 'cluster-resource-type',
    collectionPath: '/api/v1/clusterresourcetypes',
    itemPath: '/api/v1/clusterresourcetypes/{crtName}',
    nameParam: 'crtName',
    schemaPath: '/api/v1/clusterresourcetypes/{crtName}/schema',
    create: true,
    update: true,
    delete: true,
  },
  {
    kind: 'ClusterTrait',
    label: 'Cluster Trait',
    scope: 'cluster',
    nodeType: 'cluster-trait',
    collectionPath: '/api/v1/clustertraits',
    itemPath: '/api/v1/clustertraits/{clusterTraitName}',
    nameParam: 'clusterTraitName',
    schemaPath: '/api/v1/clustertraits/{clusterTraitName}/schema',
    create: true,
    update: true,
    delete: true,
  },
  {
    kind: 'ClusterWorkflow',
    label: 'Cluster Workflow',
    scope: 'cluster',
    nodeType: 'cluster-workflow',
    collectionPath: '/api/v1/clusterworkflows',
    itemPath: '/api/v1/clusterworkflows/{clusterWorkflowName}',
    nameParam: 'clusterWorkflowName',
    schemaPath: '/api/v1/clusterworkflows/{clusterWorkflowName}/schema',
    create: true,
    update: true,
    delete: true,
  },
  {
    kind: 'ClusterWorkflowPlane',
    label: 'Cluster Workflow Plane',
    scope: 'cluster',
    nodeType: 'cluster-workflow-plane',
    collectionPath: '/api/v1/clusterworkflowplanes',
    itemPath: '/api/v1/clusterworkflowplanes/{clusterWorkflowPlaneName}',
    nameParam: 'clusterWorkflowPlaneName',
    create: true,
    update: true,
    delete: true,
  },
];

const BY_KIND = new Map(KIND_REGISTRY.map((s) => [s.kind, s]));
const BY_NODE_TYPE = new Map(
  KIND_REGISTRY.filter((s) => s.nodeType).map((s) => [s.nodeType as ResourceNodeType, s]),
);

export function kindSpec(kind: string): KindSpec | undefined {
  return BY_KIND.get(kind);
}

export function kindSpecForNode(nodeType: ResourceNodeType | string): KindSpec | undefined {
  return BY_NODE_TYPE.get(nodeType as ResourceNodeType);
}

/** Path parameters for a resource's item route. */
export function itemPathParams(
  spec: KindSpec,
  namespace: string | undefined,
  name: string,
): Record<string, string> {
  const params: Record<string, string> = { [spec.nameParam]: name };
  if (spec.scope === 'namespace') params.namespaceName = namespace ?? '';
  return params;
}

/** Path parameters for a resource's collection route. */
export function collectionPathParams(
  spec: KindSpec,
  namespace: string | undefined,
): Record<string, string> {
  return spec.scope === 'namespace' ? { namespaceName: namespace ?? '' } : {};
}

/**
 * Kinds other resources reference by name (the targets in schemas/refs.json).
 * Their names are pushed to the language server for completions and
 * "not found" checks.
 */
export const REFERENCE_TARGET_KINDS: readonly string[] = [
  'Project',
  'Component',
  'ComponentType',
  'ClusterComponentType',
  'ProjectType',
  'ClusterProjectType',
  'ResourceType',
  'ClusterResourceType',
  'Trait',
  'ClusterTrait',
  'Workflow',
  'ClusterWorkflow',
  'Environment',
  'DeploymentPipeline',
  'DataPlane',
  'ClusterDataPlane',
  'WorkflowPlane',
  'ClusterWorkflowPlane',
  'ObservabilityPlane',
  'ClusterObservabilityPlane',
];

/**
 * The value other resources use to reference a resource: a Component names
 * its (Cluster)ComponentType as `<workloadType>/<name>`, e.g. deployment/service.
 * Everything else is referenced by its plain name.
 */
export function referenceName(kind: string, name: string, workloadType: unknown): string {
  return (kind === 'ComponentType' || kind === 'ClusterComponentType') && typeof workloadType === 'string' && workloadType
    ? `${workloadType}/${name}`
    : name;
}

/**
 * Kinds whose resources define a `parameters` / `environmentConfigs` schema
 * that other resources fill in (Component → ComponentType, Project →
 * ProjectType, Resource → ResourceType, traits, workflows).
 */
export const PARAMETER_SCHEMA_KINDS: readonly KindSpec[] = KIND_REGISTRY.filter(
  (s) => s.schemaPath && s.kind !== 'Component',
);

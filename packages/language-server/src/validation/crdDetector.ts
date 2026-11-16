// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * All known OpenChoreo CRD kinds (openchoreo.dev/v1alpha1), as of OpenChoreo 1.3
 * plus the 1.4 additions. Source of truth: config/crd/bases in openchoreo/openchoreo.
 */
export const OPENCHOREO_CRD_KINDS = [
  // Namespaced
  'Project',
  'ProjectType',
  'ProjectRelease',
  'ProjectReleaseBinding',
  'Environment',
  'DataPlane',
  'WorkflowPlane',
  'ObservabilityPlane',
  'DeploymentPipeline',
  'Component',
  'ComponentType',
  'ComponentRelease',
  'Trait',
  'Workload',
  'Workflow',
  'WorkflowRun',
  'ReleaseBinding',
  'RenderedRelease',
  'Resource',
  'ResourceType',
  'ResourceRelease',
  'ResourceReleaseBinding',
  'SecretReference',
  'AuthzRole',
  'AuthzRoleBinding',
  'ObservabilityAlertRule',
  'ObservabilityAlertsNotificationChannel',
  // Namespaced, OpenChoreo 1.4+
  'Endpoint',
  'EndpointType',
  'EndpointRelease',
  'EndpointReleaseBinding',
  'ReleaseLine',
  // Cluster-scoped
  'ClusterComponentType',
  'ClusterProjectType',
  'ClusterResourceType',
  'ClusterWorkflow',
  'ClusterTrait',
  'ClusterDataPlane',
  'ClusterWorkflowPlane',
  'ClusterObservabilityPlane',
  'ClusterAuthzRole',
  'ClusterAuthzRoleBinding',
  // Cluster-scoped, OpenChoreo 1.4+
  'ClusterEndpointType',
] as const;

export type CrdKind = (typeof OPENCHOREO_CRD_KINDS)[number];

const API_VERSION_PATTERN = /^apiVersion:\s*openchoreo\.dev\/v1alpha1\s*$/m;
const KIND_PATTERN = /^kind:\s*(\S+)\s*$/m;

/**
 * Detect if a YAML document is an OpenChoreo CRD and return its kind.
 * Checks for `apiVersion: openchoreo.dev/v1alpha1` and a known `kind:`.
 */
export function detectCrdKind(text: string): CrdKind | undefined {
  if (!API_VERSION_PATTERN.test(text)) {
    return undefined;
  }

  const kindMatch = KIND_PATTERN.exec(text);
  if (!kindMatch) {
    return undefined;
  }

  const kind = kindMatch[1];
  if (OPENCHOREO_CRD_KINDS.includes(kind as CrdKind)) {
    return kind as CrdKind;
  }

  return undefined;
}

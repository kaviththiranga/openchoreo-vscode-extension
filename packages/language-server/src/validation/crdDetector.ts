// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * All known OpenChoreo CRD kinds.
 */
export const OPENCHOREO_CRD_KINDS = [
  'Organization',
  'Project',
  'Environment',
  'DataPlane',
  'WorkflowPlane',
  'Component',
  'ComponentType',
  'Trait',
  'Workload',
  'Workflow',
  'WorkflowRun',
  'ComponentRelease',
  'ReleaseBinding',
  'Release',
  'DeploymentPipeline',
  'Endpoint',
  'API',
  'APIBinding',
  'APIClass',
  'SecretReference',
  'ConfigurationGroup',
  // Cluster-scoped
  'ClusterComponentType',
  'ClusterWorkflow',
  'ClusterTrait',
  'ClusterDataPlane',
  'ClusterWorkflowPlane',
  'ClusterObservabilityPlane',
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

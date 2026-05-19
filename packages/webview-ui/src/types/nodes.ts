// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Mirrors the extension's ResourceNodeType and ResourceNodeData.
 * Kept in sync manually — these are serialized over postMessage as plain JSON.
 */

export type ResourceNodeType =
  | 'namespace' | 'project' | 'component' | 'component-category'
  | 'workflow-run' | 'component-release' | 'release-binding'
  | 'workload' | 'deployment-pipeline'
  | 'resource-category' | 'resource' | 'resource-release' | 'resource-release-binding'
  | 'infra-category' | 'environment' | 'data-plane' | 'workflow-plane'
  | 'observability-plane' | 'component-type' | 'workflow' | 'trait'
  | 'secret-reference' | 'namespace-role' | 'namespace-role-binding'
  | 'cluster-role' | 'cluster-role-binding'
  | 'cluster-component-type' | 'cluster-workflow' | 'cluster-trait'
  | 'cluster-data-plane' | 'cluster-workflow-plane' | 'cluster-observability-plane'
  | 'workflow-run-step'
  | 'k8s-resource' | 'k8s-pod' | 'k8s-rendered-release'
  | 'release-binding-placeholder'
  | 'no-connection' | 'empty';

export type ChildrenMode = 'none' | 'preloaded' | 'lazy';

export interface ResourceNodeData {
  label: string;
  type: ResourceNodeType;
  contextValue: string;
  description?: string;
  icon?: string;
  namespace?: string;
  project?: string;
  component?: string;
  resourceName?: string;
  statusPhase?: string;
  healthStatus?: string;
  extra?: Record<string, string>;
  childrenMode: ChildrenMode;
  children?: ResourceNodeData[];
  lazyChildrenKey?: string;
}

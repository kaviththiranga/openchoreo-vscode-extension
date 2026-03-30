// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

export type ResourceNodeType =
  // Resource view nodes
  | 'namespace'
  | 'project'
  | 'component'
  | 'component-category'
  | 'workflow-run'
  | 'component-release'
  | 'release-binding'
  | 'workload'
  | 'deployment-pipeline'
  // Infrastructure view nodes (namespace-scoped)
  | 'infra-category'
  | 'environment'
  | 'data-plane'
  | 'workflow-plane'
  | 'observability-plane'
  | 'component-type'
  | 'workflow'
  | 'trait'
  | 'secret-reference'
  | 'namespace-role'
  | 'namespace-role-binding'
  | 'cluster-role'
  | 'cluster-role-binding'
  // Infrastructure view nodes (cluster-scoped)
  | 'cluster-component-type'
  | 'cluster-workflow'
  | 'cluster-trait'
  | 'cluster-data-plane'
  | 'cluster-workflow-plane'
  | 'cluster-observability-plane'
  // Workflow run step nodes
  | 'workflow-run-step'
  // K8s resource tree nodes (from ReleaseBinding expansion)
  | 'k8s-resource'
  | 'k8s-pod'
  | 'k8s-rendered-release'
  // Status nodes
  | 'no-connection'
  | 'empty';

export type ChildrenMode = 'none' | 'preloaded' | 'lazy';

export interface ResourceNodeData {
  label: string;
  type: ResourceNodeType;
  contextValue: string;
  description?: string;
  /** Override the default icon from NODE_ICON_MAP. */
  icon?: string;

  // Hierarchical context (propagated from parent)
  namespace?: string;
  project?: string;
  component?: string;
  resourceName?: string;

  // Status-based icon overrides
  /** Workflow run / step phase — drives colored status icon. */
  statusPhase?: string;
  /** K8s resource health status — drives colored health icon. */
  healthStatus?: string;

  /** Arbitrary metadata for command handlers (e.g., K8s resource identifiers). */
  extra?: Record<string, string>;

  // Children strategy
  childrenMode: ChildrenMode;
  children?: ResourceNodeData[];
  lazyChildrenKey?: string;
}

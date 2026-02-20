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
  // Infrastructure view nodes
  | 'infra-category'
  | 'environment'
  | 'data-plane'
  | 'build-plane'
  | 'observability-plane'
  | 'component-type'
  | 'workflow'
  | 'component-workflow'
  | 'trait'
  | 'secret-reference'
  | 'namespace-role'
  | 'namespace-role-binding'
  | 'cluster-role'
  | 'cluster-role-binding'
  // Status nodes
  | 'no-connection'
  | 'empty';

export type ChildrenMode = 'none' | 'preloaded' | 'lazy';

export interface ResourceNodeData {
  label: string;
  type: ResourceNodeType;
  contextValue: string;
  description?: string;

  // Hierarchical context (propagated from parent)
  namespace?: string;
  project?: string;
  component?: string;
  resourceName?: string;

  // Children strategy
  childrenMode: ChildrenMode;
  children?: ResourceNodeData[];
  lazyChildrenKey?: string;
}

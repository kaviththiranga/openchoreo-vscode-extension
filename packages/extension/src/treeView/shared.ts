// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import type { ResourceNodeData, ResourceNodeType } from './types';

/**
 * Maps each node type to a VS Code ThemeIcon name.
 * Aligned with backstage-plugins Material UI icons where possible.
 */
export const NODE_ICON_MAP: Record<ResourceNodeType, string> = {
  // Resource view
  namespace: 'organization',               // Backstage: Domain
  project: 'project',                     // Backstage: System
  component: 'package',                   // Backstage: Component
  'component-category': 'symbol-folder',
  'workflow-run': 'debug-start',
  'component-release': 'tag',
  'release-binding': 'link',
  workload: 'server-process',
  'deployment-pipeline': 'git-merge',     // Backstage: AccountTree
  // Infrastructure view (namespace-scoped)
  'infra-category': 'symbol-folder',
  environment: 'cloud',                   // Backstage: Cloud
  'data-plane': 'server',                 // Backstage: Dns
  'workflow-plane': 'wrench',             // Backstage: Build
  'observability-plane': 'eye',           // Backstage: Visibility
  'component-type': 'symbol-class',       // Backstage: Category
  workflow: 'play-circle',                // Backstage: PlayCircleOutline
  trait: 'extensions',                    // Backstage: Extension
  'secret-reference': 'key',
  'namespace-role': 'shield',
  'namespace-role-binding': 'person',
  'cluster-role': 'shield',
  'cluster-role-binding': 'person',
  // Infrastructure view (cluster-scoped) — mirrors namespace-scoped
  'cluster-component-type': 'symbol-class',
  'cluster-workflow': 'play-circle',
  'cluster-trait': 'extensions',
  'cluster-data-plane': 'server',
  'cluster-workflow-plane': 'wrench',
  'cluster-observability-plane': 'eye',
  // Status
  'no-connection': 'warning',
  empty: 'info',
};

/** Builds a unique tree node ID from node context. */
export function buildNodeId(node: ResourceNodeData): string {
  const parts: string[] = [node.type];
  if (node.namespace) {
    parts.push(node.namespace);
  }
  if (node.project) {
    parts.push(node.project);
  }
  if (node.component) {
    parts.push(node.component);
  }
  if (node.resourceName) {
    parts.push(node.resourceName);
  }
  if (
    node.type === 'component-category' ||
    node.type === 'infra-category'
  ) {
    parts.push(node.label);
  }
  return parts.join(':');
}

/** Converts a ResourceNodeData into a VS Code TreeItem. */
export function toTreeItem(element: ResourceNodeData): vscode.TreeItem {
  const isLeaf =
    element.childrenMode === 'none' ||
    (element.childrenMode === 'preloaded' &&
      (!element.children || element.children.length === 0));

  const collapsible = isLeaf
    ? vscode.TreeItemCollapsibleState.None
    : vscode.TreeItemCollapsibleState.Collapsed;

  const treeItem = new vscode.TreeItem(element.label, collapsible);
  treeItem.contextValue = element.contextValue;
  // Only set explicit IDs on container nodes (namespace, project, component,
  // categories) to preserve expand/collapse state across refreshes.
  // Leaf nodes skip explicit IDs to avoid collisions when the API returns
  // duplicate names (e.g. multiple traits with the same name on a component).
  if (element.childrenMode !== 'none') {
    treeItem.id = buildNodeId(element);
  }
  treeItem.iconPath = new vscode.ThemeIcon(
    element.icon ?? NODE_ICON_MAP[element.type] ?? 'circle-outline',
  );

  if (element.description) {
    treeItem.description = element.description;
  }

  // Leaf resource nodes are clickable to open their API response
  if (
    element.type !== 'no-connection' &&
    element.type !== 'empty' &&
    element.type !== 'component-category' &&
    element.type !== 'infra-category'
  ) {
    treeItem.command = {
      command: 'openchoreo.openResource',
      title: 'Open Resource',
      arguments: [element],
    };
  }

  return treeItem;
}

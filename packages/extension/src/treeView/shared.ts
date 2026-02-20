// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import type { ResourceNodeData, ResourceNodeType } from './types';

/** Maps each node type to a VS Code ThemeIcon name. */
export const NODE_ICON_MAP: Record<ResourceNodeType, string> = {
  // Resource view
  namespace: 'database',
  project: 'folder',
  component: 'package',
  'component-category': 'symbol-folder',
  'workflow-run': 'play-circle',
  'component-release': 'tag',
  'release-binding': 'link',
  workload: 'server-process',
  'deployment-pipeline': 'git-merge',
  // Infrastructure view
  'infra-category': 'symbol-folder',
  environment: 'server-environment',
  'data-plane': 'vm',
  'build-plane': 'tools',
  'observability-plane': 'graph-line',
  'component-type': 'symbol-class',
  workflow: 'tasklist',
  'component-workflow': 'tasklist',
  trait: 'extensions',
  'secret-reference': 'key',
  'namespace-role': 'shield',
  'namespace-role-binding': 'person',
  'cluster-role': 'shield',
  'cluster-role-binding': 'person',
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
    NODE_ICON_MAP[element.type] ?? 'circle-outline',
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

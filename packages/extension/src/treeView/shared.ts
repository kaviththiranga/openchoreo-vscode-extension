// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import type { ResourceNodeData, ResourceNodeType } from './types';

/** Set during extension activation — needed for resolving custom SVG icon paths. */
let extensionUri: vscode.Uri | undefined;

/** Call once during activation to enable custom icon resolution. */
export function setExtensionUri(uri: vscode.Uri): void {
  extensionUri = uri;
}

/**
 * Maps resource types to custom Material UI SVG icon filenames.
 * These match the icons used in the backstage-plugins UI.
 */
const MUI_ICON_MAP: Partial<Record<ResourceNodeType, string>> = {
  // Developer resources
  namespace: 'apartment.svg',
  project: 'dashboard.svg',
  component: 'memory.svg',
  workload: 'storage.svg',
  // Infrastructure resources
  environment: 'cloud.svg',
  'data-plane': 'dns.svg',
  'cluster-data-plane': 'dns.svg',
  'workflow-plane': 'build.svg',
  'cluster-workflow-plane': 'build.svg',
  'observability-plane': 'visibility.svg',
  'cluster-observability-plane': 'visibility.svg',
  'component-type': 'category.svg',
  'cluster-component-type': 'category.svg',
  trait: 'extension.svg',
  'cluster-trait': 'extension.svg',
  workflow: 'play-circle-outline.svg',
  'cluster-workflow': 'play-circle-outline.svg',
  'deployment-pipeline': 'account-tree.svg',
};

/**
 * Fallback ThemeIcon map for types without custom SVG icons.
 */
const THEME_ICON_MAP: Record<ResourceNodeType, string> = {
  // Resource view
  namespace: 'organization',
  project: 'project',
  component: 'package',
  'component-category': 'symbol-folder',
  'workflow-run': 'debug-start',
  'component-release': 'tag',
  'release-binding': 'link',
  workload: 'server-process',
  'deployment-pipeline': 'git-merge',
  // Infrastructure view (namespace-scoped)
  'infra-category': 'symbol-folder',
  environment: 'cloud',
  'data-plane': 'server',
  'workflow-plane': 'wrench',
  'observability-plane': 'eye',
  'component-type': 'symbol-class',
  workflow: 'play-circle',
  trait: 'extensions',
  'secret-reference': 'key',
  'namespace-role': 'shield',
  'namespace-role-binding': 'person',
  'cluster-role': 'shield',
  'cluster-role-binding': 'person',
  // Infrastructure view (cluster-scoped)
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

/** Resolve icon for a resource type — custom SVG if available, ThemeIcon otherwise. */
function resolveIcon(
  type: ResourceNodeType,
  iconOverride?: string,
): vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri } {
  // Check for custom SVG icon (from MUI_ICON_MAP or icon override on node)
  const muiFile = iconOverride
    ? MUI_ICON_MAP[iconOverride as ResourceNodeType]
    : MUI_ICON_MAP[type];

  if (muiFile && extensionUri) {
    const iconUri = vscode.Uri.joinPath(extensionUri, 'resources', 'icons', muiFile);
    return { light: iconUri, dark: iconUri };
  }

  // Fallback to ThemeIcon — look up override as resource type first
  const themeIconName = iconOverride
    ? (THEME_ICON_MAP[iconOverride as ResourceNodeType] ?? 'circle-outline')
    : (THEME_ICON_MAP[type] ?? 'circle-outline');
  return new vscode.ThemeIcon(themeIconName);
}

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
  if (element.childrenMode !== 'none') {
    treeItem.id = buildNodeId(element);
  }
  treeItem.iconPath = resolveIcon(element.type, element.icon);

  if (element.description) {
    treeItem.description = element.description;
  }

  // "Not connected" / "Session expired" nodes trigger login on click
  if (element.type === 'no-connection') {
    treeItem.command = {
      command: 'openchoreo.login',
      title: 'Login',
    };
  } else if (
    element.type !== 'empty' &&
    element.type !== 'component-category' &&
    element.type !== 'infra-category'
  ) {
    // Leaf resource nodes are clickable to open their API response
    treeItem.command = {
      command: 'openchoreo.openResource',
      title: 'Open Resource',
      arguments: [element],
    };
  }

  return treeItem;
}

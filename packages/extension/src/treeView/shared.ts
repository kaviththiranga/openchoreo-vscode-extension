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
  // Workflow run steps & K8s resource tree
  'workflow-run-step': 'circle-outline',
  'k8s-resource': 'symbol-object',
  'k8s-pod': 'server-process',
  'k8s-rendered-release': 'layers',
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

/** Map workflow run/step phase to a colored ThemeIcon. */
export function phaseIcon(phase: string): vscode.ThemeIcon {
  switch (phase) {
    case 'Succeeded': return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
    case 'Failed':    return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
    case 'Running':   return new vscode.ThemeIcon('sync~spin');
    case 'Pending':   return new vscode.ThemeIcon('clock');
    case 'Skipped':   return new vscode.ThemeIcon('debug-step-over');
    case 'Error':     return new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
    default:          return new vscode.ThemeIcon('circle-outline');
  }
}

/** Map K8s resource health status to a colored ThemeIcon. */
export function healthIcon(status: string): vscode.ThemeIcon {
  switch (status) {
    case 'Healthy':     return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
    case 'Degraded':    return new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
    case 'Progressing': return new vscode.ThemeIcon('sync~spin');
    case 'Missing':     return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
    default:            return new vscode.ThemeIcon('question');
  }
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

  // Override icon with colored status/health icons when available
  if (element.statusPhase) {
    treeItem.iconPath = phaseIcon(element.statusPhase);
  } else if (element.healthStatus) {
    treeItem.iconPath = healthIcon(element.healthStatus);
  }

  if (element.description) {
    treeItem.description = element.description;
  }

  // Non-clickable node types
  const NON_CLICKABLE: ReadonlySet<string> = new Set([
    'no-connection', 'empty', 'component-category', 'infra-category',
    'workflow-run-step', 'k8s-resource', 'k8s-pod', 'k8s-rendered-release',
  ]);

  // "Not connected" / "Session expired" nodes trigger login on click
  if (element.type === 'no-connection') {
    treeItem.command = {
      command: 'openchoreo.login',
      title: 'Login',
    };
  } else if (!NON_CLICKABLE.has(element.type)) {
    // Leaf resource nodes are clickable to open their API response
    treeItem.command = {
      command: 'openchoreo.openResource',
      title: 'Open Resource',
      arguments: [element],
    };
  }

  return treeItem;
}

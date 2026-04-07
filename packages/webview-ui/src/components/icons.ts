// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { ResourceNodeType } from '../types/nodes';

/**
 * Maps resource types to custom SVG icon filenames.
 * Mirrors MUI_ICON_MAP from extension's shared.ts.
 */
const SVG_ICON_MAP: Partial<Record<ResourceNodeType, string>> = {
  namespace: 'apartment.svg',
  project: 'dashboard.svg',
  component: 'memory.svg',
  workload: 'storage.svg',
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
  'namespace-role': 'security.svg',
  'cluster-role': 'security.svg',
  'namespace-role-binding': 'link.svg',
  'cluster-role-binding': 'link.svg',
};

/**
 * Fallback codicon map for types without custom SVG icons.
 */
const CODICON_MAP: Record<ResourceNodeType, string> = {
  namespace: 'symbol-namespace',
  project: 'project',
  component: 'package',
  'component-category': 'symbol-folder',
  'workflow-run': 'debug-start',
  'component-release': 'tag',
  'release-binding': 'link',
  workload: 'server-process',
  'deployment-pipeline': 'git-merge',
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
  'cluster-component-type': 'symbol-class',
  'cluster-workflow': 'play-circle',
  'cluster-trait': 'extensions',
  'cluster-data-plane': 'server',
  'cluster-workflow-plane': 'wrench',
  'cluster-observability-plane': 'eye',
  'workflow-run-step': 'circle-outline',
  'k8s-resource': 'symbol-object',
  'k8s-pod': 'server-process',
  'k8s-rendered-release': 'layers',
  'no-connection': 'warning',
  empty: 'info',
};

/** Phase → codicon + CSS color class for workflow runs/steps. */
export function phaseIcon(phase: string): { codicon: string; colorClass: string } {
  switch (phase) {
    case 'Succeeded': return { codicon: 'pass', colorClass: 'icon-success' };
    case 'Failed':    return { codicon: 'error', colorClass: 'icon-error' };
    case 'Running':   return { codicon: 'sync', colorClass: 'icon-running' };
    case 'Pending':   return { codicon: 'clock', colorClass: '' };
    case 'Skipped':   return { codicon: 'debug-step-over', colorClass: '' };
    case 'Error':     return { codicon: 'warning', colorClass: 'icon-warning' };
    default:          return { codicon: 'circle-outline', colorClass: '' };
  }
}

/** K8s health status → codicon + CSS color class. */
export function healthIcon(status: string): { codicon: string; colorClass: string } {
  switch (status) {
    case 'Healthy':     return { codicon: 'pass', colorClass: 'icon-success' };
    case 'Degraded':    return { codicon: 'warning', colorClass: 'icon-warning' };
    case 'Progressing': return { codicon: 'sync', colorClass: 'icon-running' };
    case 'Missing':     return { codicon: 'error', colorClass: 'icon-error' };
    default:            return { codicon: 'question', colorClass: '' };
  }
}

export type ResolvedIcon =
  | { kind: 'codicon'; codicon: string; colorClass: string }
  | { kind: 'svg'; filename: string };

/** Resolve the icon for a node — SVG if available, codicon fallback. */
export function resolveNodeIcon(
  type: ResourceNodeType,
  statusPhase?: string,
  healthStatus?: string,
  iconOverride?: string,
): ResolvedIcon {
  // Status/health icons are always codicons (colored)
  if (statusPhase) return { kind: 'codicon', ...phaseIcon(statusPhase) };
  if (healthStatus) return { kind: 'codicon', ...healthIcon(healthStatus) };

  // Check for SVG icon (with override support)
  const svgFile = iconOverride
    ? SVG_ICON_MAP[iconOverride as ResourceNodeType]
    : SVG_ICON_MAP[type];
  if (svgFile) return { kind: 'svg', filename: svgFile };

  // Codicon fallback (with override support)
  if (iconOverride) {
    const overrideIcon = CODICON_MAP[iconOverride as ResourceNodeType];
    if (overrideIcon) return { kind: 'codicon', codicon: overrideIcon, colorClass: '' };
  }
  return { kind: 'codicon', codicon: CODICON_MAP[type] ?? 'circle-outline', colorClass: '' };
}

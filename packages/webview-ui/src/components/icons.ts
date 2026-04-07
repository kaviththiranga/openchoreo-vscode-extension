// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { ResourceNodeType } from '../types/nodes';

/**
 * Maps resource node types to codicon names.
 * Mirrors THEME_ICON_MAP from extension's shared.ts.
 */
export const CODICON_MAP: Record<ResourceNodeType, string> = {
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

/** Resolve the codicon name and color class for a node. */
export function resolveNodeIcon(
  type: ResourceNodeType,
  statusPhase?: string,
  healthStatus?: string,
  iconOverride?: string,
): { codicon: string; colorClass: string } {
  if (statusPhase) return phaseIcon(statusPhase);
  if (healthStatus) return healthIcon(healthStatus);
  // Icon override: look up the override as a resource type in the codicon map
  if (iconOverride) {
    const overrideIcon = CODICON_MAP[iconOverride as ResourceNodeType];
    if (overrideIcon) return { codicon: overrideIcon, colorClass: '' };
  }
  return { codicon: CODICON_MAP[type] ?? 'circle-outline', colorClass: '' };
}

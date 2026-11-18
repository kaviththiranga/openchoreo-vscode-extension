// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Which OpenChoreo resources a GitOps tool owns, and the guard in front of
 * changes made through the API. A change to a Flux- or Argo CD-owned resource
 * is reverted at the next sync; a new resource drifts from Git.
 *
 * OpenChoreo has no first-class "GitOps-managed" marker yet, so ownership is
 * read from the tools' own labels and annotations, and the
 * `openchoreo.gitops.mode` setting can declare every resource managed.
 */
import * as vscode from 'vscode';

export interface GitOpsOwner {
  tool: 'Flux' | 'Argo CD';
  /** The Flux Kustomization/HelmRelease or Argo CD Application, when known. */
  source?: string;
}

interface Metadata {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

const FLUX_KUSTOMIZE = 'kustomize.toolkit.fluxcd.io/name';
const FLUX_HELM = 'helm.toolkit.fluxcd.io/name';
const ARGO_TRACKING = 'argocd.argoproj.io/tracking-id';
const ARGO_INSTANCE = 'argocd.argoproj.io/instance';

/** Labels and annotations GitOps tools stamp on what they apply. */
export const GITOPS_METADATA_PREFIXES = ['kustomize.toolkit.fluxcd.io/', 'helm.toolkit.fluxcd.io/', 'argocd.argoproj.io/'];

export function gitopsOwner(metadata: Metadata | undefined): GitOpsOwner | undefined {
  const labels = metadata?.labels ?? {};
  const annotations = metadata?.annotations ?? {};
  for (const key of [FLUX_KUSTOMIZE, FLUX_HELM]) {
    const name = labels[key];
    if (name) {
      const ns = labels[key.replace(/\/name$/, '/namespace')];
      return { tool: 'Flux', source: ns ? `${ns}/${name}` : name };
    }
  }
  const tracking = annotations[ARGO_TRACKING];
  if (tracking) return { tool: 'Argo CD', source: tracking.split(':')[0] };
  const instance = labels[ARGO_INSTANCE];
  if (instance) return { tool: 'Argo CD', source: instance };
  return undefined;
}

/** Encode an owner into a tree node's `extra` (string values only). */
export function ownerExtra(owner: GitOpsOwner | undefined): Record<string, string> {
  return owner ? { gitopsTool: owner.tool, ...(owner.source ? { gitopsSource: owner.source } : {}) } : {};
}

export function ownerFromExtra(extra: Record<string, string> | undefined): GitOpsOwner | undefined {
  const tool = extra?.gitopsTool;
  return tool === 'Flux' || tool === 'Argo CD' ? { tool, source: extra?.gitopsSource || undefined } : undefined;
}

export function describeOwner(owner: GitOpsOwner): string {
  return owner.source ? `${owner.tool} (${owner.source})` : owner.tool;
}

export type GitOpsMode = 'detect' | 'all' | 'off';

export function gitopsMode(): GitOpsMode {
  const mode = vscode.workspace.getConfiguration('openchoreo.gitops').get<string>('mode', 'detect');
  return mode === 'all' || mode === 'off' ? mode : 'detect';
}

export interface WriteTarget {
  kind: string;
  name: string;
  owner?: GitOpsOwner;
  /** True for a resource that doesn't exist yet. */
  isNew?: boolean;
}

export type WriteDecision = 'api' | 'repository' | 'cancel';

/** The owner to guard a write with, or undefined when the write can go straight to the API. */
export function guardingOwner(target: WriteTarget, mode: GitOpsMode = gitopsMode()): GitOpsOwner | 'declared' | undefined {
  if (mode === 'off') return undefined;
  if (target.owner) return target.owner;
  return mode === 'all' ? 'declared' : undefined;
}

/**
 * Ask before an API write to a GitOps-managed resource. Resolves to 'api'
 * straight away when the resource isn't managed.
 *
 * @param action what the user is doing, e.g. "Promote", "Save", "Delete".
 * @param canUseRepository whether "Change in Repository" can handle this write.
 */
export async function confirmApiWrite(
  target: WriteTarget,
  action: string,
  canUseRepository: boolean,
): Promise<WriteDecision> {
  const owner = guardingOwner(target);
  if (!owner) return 'api';
  const who = owner === 'declared' ? 'managed through GitOps' : `managed by ${describeOwner(owner)}`;
  const effect = target.isNew
    ? 'Creating it through the API leaves it out of Git, so the cluster drifts from the repository.'
    : action === 'Delete'
      ? 'Deleting it through the API is undone at the next sync unless it is removed from Git.'
      : 'A change made through the API is reverted at the next sync.';
  const REPO = 'Change in Repository';
  const API = 'Continue Anyway';
  const allowApi = vscode.workspace.getConfiguration('openchoreo.gitops').get<boolean>('allowDirectChanges', true);
  const buttons = [...(canUseRepository ? [REPO] : []), ...(allowApi ? [API] : [])];
  const detail = canUseRepository
    ? effect
    : `${effect}${allowApi ? '' : ' Direct changes are turned off (openchoreo.gitops.allowDirectChanges).'} Open the GitOps repository in this window to change it there.`;
  const choice = await vscode.window.showWarningMessage(
    `${action}: ${target.kind} "${target.name}" is ${who}.`,
    { modal: true, detail },
    ...buttons,
  );
  return choice === REPO ? 'repository' : choice === API ? 'api' : 'cancel';
}

const SERVER_METADATA = [
  'uid',
  'resourceVersion',
  'generation',
  'creationTimestamp',
  'deletionTimestamp',
  'deletionGracePeriodSeconds',
  'managedFields',
  'ownerReferences',
  'finalizers',
  'selfLink',
];
const SERVER_ANNOTATIONS = ['kubectl.kubernetes.io/last-applied-configuration'];

/**
 * A resource as it would be written in Git: the envelope, name, namespace,
 * labels, annotations and spec, without status, server-set metadata or the
 * GitOps tools' own markers.
 */
export function toDesiredState(resource: Record<string, unknown>): Record<string, unknown> {
  const { status: _status, metadata, ...rest } = resource;
  const out: Record<string, unknown> = {};
  if (rest.apiVersion !== undefined) out.apiVersion = rest.apiVersion;
  if (rest.kind !== undefined) out.kind = rest.kind;
  if (metadata && typeof metadata === 'object') {
    const meta: Record<string, unknown> = { ...(metadata as Record<string, unknown>) };
    for (const key of SERVER_METADATA) delete meta[key];
    for (const field of ['labels', 'annotations'] as const) {
      const values = meta[field] as Record<string, string> | undefined;
      if (!values || typeof values !== 'object') continue;
      const kept = Object.fromEntries(
        Object.entries(values).filter(
          ([k]) => !GITOPS_METADATA_PREFIXES.some((p) => k.startsWith(p)) && !SERVER_ANNOTATIONS.includes(k),
        ),
      );
      if (Object.keys(kept).length > 0) meta[field] = kept;
      else delete meta[field];
    }
    out.metadata = meta;
  }
  for (const [key, value] of Object.entries(rest)) {
    if (key !== 'apiVersion' && key !== 'kind') out[key] = value;
  }
  return out;
}

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { parse } from 'yaml';
import { gitopsOwner, guardingOwner, ownerExtra, ownerFromExtra, toDesiredState } from '../gitops/managed';
import { changedPaths, entriesFromText, isAppManifest } from '../gitops/repoIndex';
import { alignKeys, liveUri, liveYaml, parseLiveUri, resourceAt } from '../gitops/compare';
import { markGitOps } from '../treeView/shared';

describe('GitOps ownership', () => {
  it('reads Flux Kustomization and HelmRelease labels', () => {
    expect(
      gitopsOwner({
        labels: { 'kustomize.toolkit.fluxcd.io/name': 'apps', 'kustomize.toolkit.fluxcd.io/namespace': 'flux-system' },
      }),
    ).toEqual({ tool: 'Flux', source: 'flux-system/apps' });
    expect(gitopsOwner({ labels: { 'helm.toolkit.fluxcd.io/name': 'platform' } })).toEqual({ tool: 'Flux', source: 'platform' });
  });

  it('reads Argo CD tracking', () => {
    expect(gitopsOwner({ annotations: { 'argocd.argoproj.io/tracking-id': 'shop:openchoreo.dev/Component:default/api' } })).toEqual({
      tool: 'Argo CD',
      source: 'shop',
    });
  });

  it("doesn't take Helm's own instance label for GitOps", () => {
    expect(gitopsOwner({ labels: { 'app.kubernetes.io/instance': 'openchoreo-control-plane' } })).toBeUndefined();
    expect(gitopsOwner(undefined)).toBeUndefined();
  });

  it('round-trips the owner through tree node extras', () => {
    const owner = { tool: 'Flux' as const, source: 'flux-system/apps' };
    expect(ownerFromExtra(ownerExtra(owner))).toEqual(owner);
    expect(ownerFromExtra({ environment: 'dev' })).toBeUndefined();
  });

  it('guards by mode', () => {
    const owner = { tool: 'Flux' as const };
    expect(guardingOwner({ kind: 'Component', name: 'a', owner }, 'detect')).toBe(owner);
    expect(guardingOwner({ kind: 'Component', name: 'a' }, 'detect')).toBeUndefined();
    expect(guardingOwner({ kind: 'Component', name: 'a' }, 'all')).toBe('declared');
    expect(guardingOwner({ kind: 'Component', name: 'a', owner }, 'off')).toBeUndefined();
  });

  it('marks tree nodes, inheriting the parent owner', () => {
    const node = { label: 'api', type: 'component' as const, contextValue: 'component_editable', childrenMode: 'none' as const };
    const marked = markGitOps(node, { labels: { 'kustomize.toolkit.fluxcd.io/name': 'apps' } });
    expect(marked.contextValue).toBe('component_editable_gitops');
    expect(marked.extra).toEqual({ gitopsTool: 'Flux', gitopsSource: 'apps' });
    expect(markGitOps(node, undefined, marked.extra).contextValue).toBe('component_editable_gitops');
    expect(markGitOps(node, {})).toBe(node);
  });

  it('strips status, server metadata and GitOps markers for Git', () => {
    const live = {
      apiVersion: 'openchoreo.dev/v1alpha1',
      kind: 'ReleaseBinding',
      metadata: {
        name: 'api-dev',
        namespace: 'default',
        uid: 'u',
        resourceVersion: '7',
        generation: 2,
        creationTimestamp: 't',
        labels: { 'kustomize.toolkit.fluxcd.io/name': 'apps', team: 'shop' },
        annotations: { 'kubectl.kubernetes.io/last-applied-configuration': '{}' },
      },
      spec: { environment: 'development', releaseName: 'api-1' },
      status: { conditions: [] },
    };
    expect(toDesiredState(live)).toEqual({
      apiVersion: 'openchoreo.dev/v1alpha1',
      kind: 'ReleaseBinding',
      metadata: { name: 'api-dev', namespace: 'default', labels: { team: 'shop' } },
      spec: { environment: 'development', releaseName: 'api-1' },
    });
  });
});

describe('GitOps repository index', () => {
  const file = vscode.Uri.file('/repo/namespaces/acme/projects/shop/components/api.yaml') as vscode.Uri;
  const text = `# The shop API
apiVersion: openchoreo.dev/v1alpha1
kind: Component
metadata:
  name: api
spec:
  owner: { projectName: shop }
---
apiVersion: v1
kind: ConfigMap
metadata: { name: unrelated }
---
apiVersion: openchoreo.dev/v1alpha1
kind: ReleaseBinding
metadata:
  name: api-development
  namespace: other
spec:
  releaseName: api-1
---
apiVersion: openchoreo.dev/v1alpha1
kind: ClusterComponentType
metadata:
  name: deployment-service
`;

  it('indexes OpenChoreo documents with their namespace and line', () => {
    const entries = entriesFromText(text, file, 'namespaces/acme/projects/shop/components/api.yaml');
    expect(entries.map(({ kind, name, namespace, docIndex, line }) => ({ kind, name, namespace, docIndex, line }))).toEqual([
      { kind: 'Component', name: 'api', namespace: 'acme', docIndex: 0, line: 1 },
      { kind: 'ReleaseBinding', name: 'api-development', namespace: 'other', docIndex: 2, line: 12 },
      { kind: 'ClusterComponentType', name: 'deployment-service', namespace: undefined, docIndex: 3, line: 20 },
    ]);
  });

  it('skips files without OpenChoreo resources and broken documents', () => {
    expect(entriesFromText('kind: ConfigMap\n', file, 'a.yaml')).toEqual([]);
    expect(entriesFromText('apiVersion: openchoreo.dev/v1alpha1\nkind: [\n', file, 'a.yaml')).toEqual([]);
  });

  it("tells an app's own manifests from a GitOps repository", () => {
    expect(isAppManifest('.openchoreo/component.yaml')).toBe(true);
    expect(isAppManifest('services/api/workload.yaml')).toBe(true);
    expect(isAppManifest('namespaces/acme/projects/shop/components/api/workload.yaml')).toBe(true);
    expect(isAppManifest('namespaces/acme/projects/shop/components/api/component.yaml')).toBe(false);
  });

  it('computes leaf changes, treating arrays whole', () => {
    expect(
      changedPaths(
        { spec: { releaseName: 'a', environment: 'dev', traits: [1], drop: true } },
        { spec: { releaseName: 'b', environment: 'dev', traits: [1, 2], add: { x: 1 } } },
      ),
    ).toEqual([
      { path: ['spec', 'releaseName'], value: 'b' },
      { path: ['spec', 'traits'], value: [1, 2] },
      { path: ['spec', 'add'], value: { x: 1 } },
      { path: ['spec', 'drop'], deleted: true },
    ]);
    expect(changedPaths({ a: 1 }, { a: 1 })).toEqual([]);
  });
});

describe('Compare with Cluster', () => {
  it('orders the live side like the file', () => {
    const live = { kind: 'C', apiVersion: 'v', spec: { b: 1, a: 2, extra: 3 }, metadata: { name: 'x' } };
    const local = { apiVersion: 'v', kind: 'C', metadata: { name: 'x' }, spec: { a: 0, b: 0 } };
    expect(Object.keys(alignKeys(live, local) as object)).toEqual(['apiVersion', 'kind', 'metadata', 'spec']);
    expect(Object.keys((alignKeys(live, local) as { spec: object }).spec)).toEqual(['a', 'b', 'extra']);
    // Zero values the API omits don't show as differences.
    expect(alignKeys({ spec: { dataPlaneRef: 'x', gateway: {} } }, { spec: { dataPlaneRef: 'x', isProduction: false } }))
      .toEqual({ spec: { dataPlaneRef: 'x', isProduction: false } });
    expect(alignKeys({ spec: { gateway: { host: 'h' } } }, { spec: {} })).toEqual({ spec: { gateway: { host: 'h' } } });
  });

  it('renders the live side without status', () => {
    const out = parse(liveYaml({ apiVersion: 'v', kind: 'C', metadata: { name: 'x', uid: '1' }, spec: { a: 1 }, status: { ok: true } }));
    expect(out).toEqual({ apiVersion: 'v', kind: 'C', metadata: { name: 'x' }, spec: { a: 1 } });
  });

  it('finds the resource at the cursor in a multi-document file', () => {
    const text = 'apiVersion: openchoreo.dev/v1alpha1\nkind: Project\nmetadata:\n  name: shop\n---\napiVersion: openchoreo.dev/v1alpha1\nkind: Component\nmetadata:\n  name: api\n  namespace: acme\n';
    expect(resourceAt(text)).toEqual({ kind: 'Project', name: 'shop', namespace: undefined, docIndex: 0 });
    expect(resourceAt(text, text.indexOf('kind: Component'))).toEqual({ kind: 'Component', name: 'api', namespace: 'acme', docIndex: 1 });
    expect(resourceAt('kind: ConfigMap\n')).toBeUndefined();
  });
});

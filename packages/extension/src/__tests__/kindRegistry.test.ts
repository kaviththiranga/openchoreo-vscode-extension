// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { KIND_REGISTRY, kindSpec, kindSpecForNode, REFERENCE_TARGET_KINDS } from '../kinds/registry';
import { buildPostRequest, buildPutRequest } from '../services/apiRoutes';
import { ResourceService } from '../services/resourceService';

describe('KIND_REGISTRY', () => {
  it('has unique kinds and node types', () => {
    const kinds = KIND_REGISTRY.map((s) => s.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    const nodeTypes = KIND_REGISTRY.flatMap((s) => (s.nodeType ? [s.nodeType] : []));
    expect(new Set(nodeTypes).size).toBe(nodeTypes.length);
  });

  it.each(KIND_REGISTRY.map((s) => [s.kind, s] as const))('%s has consistent routes', (_k, spec) => {
    expect(spec.itemPath.startsWith(`${spec.collectionPath}/`)).toBe(true);
    expect(spec.itemPath.endsWith(`{${spec.nameParam}}`)).toBe(true);
    expect(spec.collectionPath.includes('{namespaceName}')).toBe(spec.scope === 'namespace');
    expect(spec.kind.startsWith('Cluster')).toBe(spec.scope === 'cluster');
    if (spec.schemaPath) expect(spec.schemaPath).toBe(`${spec.itemPath}/schema`);
  });

  it('keeps run history and releases read-only', () => {
    for (const kind of ['WorkflowRun', 'ComponentRelease', 'ProjectRelease']) {
      expect(kindSpec(kind)).toMatchObject({ update: false, delete: false });
    }
  });
});

describe('request builders', () => {
  const body = { apiVersion: 'openchoreo.dev/v1alpha1', kind: 'Project', metadata: { name: 'p1' }, spec: {} };

  it('builds namespaced PUT and POST requests without the CRD envelope', () => {
    expect(buildPutRequest('Project', 'p1', 'default', body)).toEqual({
      path: '/api/v1/namespaces/{namespaceName}/projects/{projectName}',
      params: { path: { namespaceName: 'default', projectName: 'p1' } },
      body: { metadata: { name: 'p1' }, spec: {} },
    });
    expect(buildPostRequest('Project', 'default', body)).toEqual({
      path: '/api/v1/namespaces/{namespaceName}/projects',
      params: { path: { namespaceName: 'default' } },
      body: { metadata: { name: 'p1' }, spec: {} },
    });
  });

  it('builds cluster-scoped requests without a namespace', () => {
    expect(buildPutRequest('ClusterTrait', 't1', '', body)?.params).toEqual({
      path: { clusterTraitName: 't1' },
    });
    expect(buildPostRequest('ClusterTrait', '', body)?.params).toEqual({ path: {} });
  });

  it('covers OpenChoreo 1.3 kinds', () => {
    expect(buildPutRequest('ProjectType', 'web', 'default', body)?.path).toBe(
      '/api/v1/namespaces/{namespaceName}/projecttypes/{ptName}',
    );
    expect(buildPostRequest('ClusterProjectType', '', body)?.path).toBe('/api/v1/clusterprojecttypes');
  });

  it('refuses unknown kinds and updates to immutable kinds', () => {
    expect(buildPutRequest('Organization', 'x', 'default', body)).toBeNull();
    expect(buildPutRequest('ComponentRelease', 'r1', 'default', body)).toBeNull();
  });
});

describe('ResourceService', () => {
  const svc = new ResourceService();

  it('maps role nodes to the real authz kinds', () => {
    expect(svc.getCrdKind('namespace-role')).toBe('AuthzRole');
    expect(svc.getCrdKind('cluster-role-binding')).toBe('ClusterAuthzRoleBinding');
    expect(svc.isClusterScoped('cluster-role')).toBe(true);
    expect(svc.isClusterScoped('namespace-role')).toBe(false);
  });

  it('knows tree node types from the explorers', () => {
    expect(kindSpecForNode('cluster-workflow-plane')?.kind).toBe('ClusterWorkflowPlane');
    expect(kindSpecForNode('k8s-pod')).toBeUndefined();
  });
});

describe('language server feed', () => {
  it('pushes names for every reference target in schemas/refs.json', () => {
    const refs = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../../schemas/refs.json'), 'utf-8'),
    ) as Record<string, Record<string, string> | string>;
    const targets = new Set(
      Object.values(refs)
        .filter((v): v is Record<string, string> => typeof v === 'object')
        .flatMap((fields) => Object.values(fields).flatMap((r) => r.split('+'))),
    );
    for (const kind of targets) {
      expect(REFERENCE_TARGET_KINDS).toContain(kind);
      expect(kindSpec(kind)).toBeDefined();
    }
  });
});

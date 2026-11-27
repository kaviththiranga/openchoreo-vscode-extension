// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import * as YAML from 'yaml';
import { CRD_KIND_TO_SCAFFOLD, cleanCrdForWriting, scaffoldTemplate } from '../services/yamlService';
import { kindSpec } from '../kinds/registry';

const server = (major: number, minor: number) => (m: number, n: number) =>
  major > m || (major === m && minor >= n);

describe('scaffoldTemplate', () => {
  it('includes the required project type on OpenChoreo 1.3+', () => {
    const doc = YAML.parse(scaffoldTemplate('Project', server(1, 3))!);
    expect(doc.spec.type).toEqual({ kind: 'ClusterProjectType', name: 'default' });
  });

  it('omits the project type for older servers that reject it', () => {
    const doc = YAML.parse(scaffoldTemplate('Project', server(1, 2))!);
    expect(doc.spec.type).toBeUndefined();
  });

  it('falls back to the plain template for kinds without versions', () => {
    expect(scaffoldTemplate('Trait', server(1, 3))).toBe(CRD_KIND_TO_SCAFFOLD.Trait);
  });

  it('names the Component type and build workflow as OpenChoreo 1.2+ requires', () => {
    const doc = YAML.parse(scaffoldTemplate('Component', server(1, 4))!);
    const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../schemas/component.json'), 'utf8'));
    const pattern = new RegExp(schema.properties.spec.properties.componentType.properties.name.pattern);
    expect(doc.spec.componentType).toEqual({ kind: 'ClusterComponentType', name: 'deployment/service' });
    expect(doc.spec.componentType.name).toMatch(pattern);
    // One of the ClusterWorkflows OpenChoreo installs, with its required repository.url.
    expect(doc.spec.workflow).toMatchObject({ kind: 'ClusterWorkflow', name: 'dockerfile-builder' });
    expect(doc.spec.workflow.parameters.repository.url).toMatch(/^https:\/\//);
  });

  it.each(['ComponentType', 'ClusterComponentType'])('%s template allows an installed ClusterWorkflow', (kind) => {
    const doc = YAML.parse(CRD_KIND_TO_SCAFFOLD[kind].replace(/\{\{\w+\}\}/g, 'x'));
    expect(doc.spec.allowedWorkflows).toEqual([{ kind: 'ClusterWorkflow', name: 'dockerfile-builder' }]);
  });

  it.each(Object.keys(CRD_KIND_TO_SCAFFOLD))('%s template is valid YAML for a creatable kind', (kind) => {
    const doc = YAML.parse(CRD_KIND_TO_SCAFFOLD[kind].replace(/\{\{\w+\}\}/g, 'x'));
    expect(doc.kind).toBe(kind);
    expect(kindSpec(kind)?.create).toBe(true);
  });
});

describe('cleanCrdForWriting', () => {
  it('drops status, server-set metadata and the last-applied annotation, keeping labels and spec', () => {
    const binding = {
      apiVersion: 'openchoreo.dev/v1alpha1',
      kind: 'ReleaseBinding',
      metadata: {
        name: 'api-production',
        namespace: 'default',
        uid: 'u1',
        creationTimestamp: '2026-11-26T23:06:39Z',
        resourceVersion: '7',
        labels: { 'openchoreo.dev/component': 'api' },
        annotations: { 'kubectl.kubernetes.io/last-applied-configuration': '{}' },
      },
      spec: { environment: 'production', releaseName: 'api-2' },
      status: { conditions: [] },
    };
    expect(cleanCrdForWriting(binding)).toEqual({
      apiVersion: 'openchoreo.dev/v1alpha1',
      kind: 'ReleaseBinding',
      metadata: { name: 'api-production', namespace: 'default', labels: { 'openchoreo.dev/component': 'api' } },
      spec: { environment: 'production', releaseName: 'api-2' },
    });
  });
});

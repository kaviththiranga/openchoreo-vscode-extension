// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import * as YAML from 'yaml';
import { CRD_KIND_TO_SCAFFOLD, scaffoldTemplate } from '../services/yamlService';
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

  it.each(Object.keys(CRD_KIND_TO_SCAFFOLD))('%s template is valid YAML for a creatable kind', (kind) => {
    const doc = YAML.parse(CRD_KIND_TO_SCAFFOLD[kind].replace(/\{\{\w+\}\}/g, 'x'));
    expect(doc.kind).toBe(kind);
    expect(kindSpec(kind)?.create).toBe(true);
  });
});

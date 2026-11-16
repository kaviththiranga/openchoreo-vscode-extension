// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getCompletionItems } from '../completion/completionProvider';
import { loadSchemas } from '../schemas/schemaLoader';
import { validateDocument } from '../validation/validator';

const schemas = loadSchemas(path.resolve(__dirname, '../../../../schemas'));

const objectSchema = (...keys: string[]) => ({
  openAPIV3Schema: {
    type: 'object',
    properties: Object.fromEntries(keys.map((k) => [k, { type: 'string' }])),
  },
});

const resourceSchemas = {
  ClusterProjectType: { default: { parameters: objectSchema('teamName', 'costCenter').openAPIV3Schema } },
  // Same name, different kind — must not leak into Project completions.
  ClusterComponentType: { default: { parameters: objectSchema('replicas').openAPIV3Schema } },
  ClusterTrait: {
    storage: { parameters: objectSchema('volumeName', 'mountPath').openAPIV3Schema },
    ingress: { parameters: objectSchema('host').openAPIV3Schema },
  },
};

/** Completions at the `|` marker. */
function complete(textWithCursor: string, kind: string) {
  const offset = textWithCursor.indexOf('|');
  const text = textWithCursor.replace('|', '');
  const doc = TextDocument.create('file:///x.yaml', 'yaml', 1, text);
  const schema = schemas[kind as keyof typeof schemas] ?? null;
  return getCompletionItems(doc, doc.positionAt(offset), schema, {}, kind as never, resourceSchemas)
    .map((i) => i.label);
}

describe('cross-document parameter completions', () => {
  it('offer the ProjectType parameters for Project spec.parameters (1.3)', () => {
    const labels = complete(
      [
        'apiVersion: openchoreo.dev/v1alpha1',
        'kind: Project',
        'metadata:',
        '  name: shop',
        'spec:',
        '  type:',
        '    kind: ClusterProjectType',
        '    name: default',
        '  parameters:',
        '    |',
      ].join('\n'),
      'Project',
    );
    expect(labels).toEqual(expect.arrayContaining(['teamName', 'costCenter']));
    expect(labels).not.toContain('replicas');
  });

  it('offer only the parameters of the trait under the cursor', () => {
    const labels = complete(
      [
        'apiVersion: openchoreo.dev/v1alpha1',
        'kind: Component',
        'metadata:',
        '  name: api',
        'spec:',
        '  traits:',
        '    - name: ingress',
        '      kind: ClusterTrait',
        '      instanceName: public',
        '    - name: storage',
        '      kind: ClusterTrait',
        '      instanceName: data',
        '      parameters:',
        '        |',
      ].join('\n'),
      'Component',
    );
    expect(labels).toEqual(expect.arrayContaining(['volumeName', 'mountPath']));
    expect(labels).not.toContain('host');
  });
});

describe('reference checks', () => {
  const env = [
    'apiVersion: openchoreo.dev/v1alpha1',
    'kind: Environment',
    'metadata:',
    '  name: dev',
    '  namespace: default',
    'spec:',
    '  dataPlaneRef:',
    '    kind: ClusterDataPlane',
    '    name: shared',
  ].join('\n');
  const run = (names: Record<string, string[]>) =>
    validateDocument(env, schemas.Environment!, TextDocument.create('file:///e.yaml', 'yaml', 1, env), names)
      .map((d) => d.message);

  it('skip a reference whose kinds were not all loaded', () => {
    // DataPlane names known, ClusterDataPlane list failed (absent) → no false warning.
    expect(run({ DataPlane: ['local'], Namespace: ['default'] })).toEqual([]);
  });

  it('flag a reference missing from every loaded kind', () => {
    expect(run({ DataPlane: ['local'], ClusterDataPlane: ['other'], Namespace: ['default'] })).toContain(
      "DataPlane or ClusterDataPlane 'shared' not found in current namespace",
    );
  });
});

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { detectCrdKind, OPENCHOREO_CRD_KINDS } from '../validation/crdDetector';
import { loadSchemas } from '../schemas/schemaLoader';
import { validateDocument } from '../validation/validator';

const schemas = loadSchemas(path.resolve(__dirname, '../../../../schemas'));
const fixturesDir = path.join(__dirname, 'fixtures');

function validate(doc: string) {
  const kind = detectCrdKind(doc);
  if (!kind) throw new Error('fixture document has no OpenChoreo kind');
  const schema = schemas[kind];
  if (!schema) throw new Error(`no generated schema for ${kind}`);
  return validateDocument(doc, schema, TextDocument.create('file:///x.yaml', 'yaml', 1, doc));
}

describe('generated CRD schemas', () => {
  it('cover every OpenChoreo 1.3 kind the language server detects', () => {
    const since14 = new Set([
      'Endpoint', 'EndpointType', 'EndpointRelease', 'EndpointReleaseBinding', 'ReleaseLine',
      'ClusterEndpointType',
    ]);
    const missing = OPENCHOREO_CRD_KINDS.filter((k) => !since14.has(k) && !schemas[k]);
    expect(missing).toEqual([]);
  });

  const docs = fs.readdirSync(fixturesDir).flatMap((file) =>
    fs
      .readFileSync(path.join(fixturesDir, file), 'utf-8')
      .split(/^---\s*$/m)
      .filter((doc) => detectCrdKind(doc))
      .map((doc) => [`${file} ${detectCrdKind(doc)}`, doc] as const),
  );

  it.each(docs)('accept the official sample %s', (_label, doc) => {
    expect(validate(doc)).toEqual([]);
  });

  it('flag misspelled fields that the API server would silently prune', () => {
    const doc = [
      'apiVersion: openchoreo.dev/v1alpha1',
      'kind: Workload',
      'metadata:',
      '  name: greeter',
      '  namespace: default',
      'spec:',
      '  owner:',
      '    projectName: demo',
      '    componentName: greeter',
      '  container:',
      '    image: ghcr.io/example/greeter:1.0',
      '    enviroment: []',
    ].join('\n');
    const messages = validate(doc).map((d) => d.message);
    expect(messages).toContain('Unknown property "enviroment" in spec.container');
  });

  it('accept the 1.3 project type reference', () => {
    const project = schemas.Project as { properties: { spec: { properties: Record<string, unknown> } } };
    expect(Object.keys(project.properties.spec.properties)).toEqual(
      expect.arrayContaining(['type', 'parameters', 'deploymentPipelineRef']),
    );
  });
});

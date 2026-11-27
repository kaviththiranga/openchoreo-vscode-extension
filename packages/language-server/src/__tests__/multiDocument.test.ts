// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { documentAt, documentSegments, isolatedDocuments } from '../documents';
import { getCompletionItems } from '../completion/completionProvider';
import { getDocumentSymbols } from '../symbols/documentSymbolProvider';
import { loadSchemas } from '../schemas/schemaLoader';
import { validateDocument } from '../validation/validator';

const schemas = loadSchemas(path.resolve(__dirname, '../../../../schemas'));

// The samples' layout: a Component, its Workload and a WorkflowRun in one file.
const text = [
  'apiVersion: openchoreo.dev/v1alpha1',
  'kind: Component',
  'metadata:',
  '  name: api',
  'spec:',
  '  owner:',
  '    projectName: shop',
  '  componentType:',
  '    kind: ClusterComponentType',
  '    name: deployment/service',
  '---',
  'apiVersion: openchoreo.dev/v1alpha1',
  'kind: Workload',
  'metadata:',
  '  name: api',
  'spec:',
  '  owner:',
  '    projectName: shop',
  '    componentName: api',
  '  container:',
  '    image: 42',
  '',
].join('\n');
const file = TextDocument.create('file:///api.yaml', 'yaml', 1, text);

describe('multi-document files', () => {
  it('split at --- lines, keeping offsets of the file', () => {
    const segments = documentSegments(text);
    expect(segments).toHaveLength(2);
    expect(text.slice(segments[1].start, segments[1].start + 11)).toBe('apiVersion:');
    const [component, workload] = isolatedDocuments(file);
    expect([component.kind, workload.kind]).toEqual(['Component', 'Workload']);
    expect(workload.document.getText()).toHaveLength(text.length);
    expect(workload.document.getText()).not.toContain('Component');
  });

  it('validate each document against its own kind, without a multiple-documents error', () => {
    const diagnostics = isolatedDocuments(file).flatMap(({ document, kind }) =>
      validateDocument(document.getText(), schemas[kind!]!, file, {}));
    expect(diagnostics.map((d) => d.message)).not.toContain(expect.stringMatching(/multiple documents/i));
    const imageError = diagnostics.find((d) => d.message.includes("Expected type 'string'"));
    expect(imageError?.range.start.line).toBe(20);
  });

  it('complete keys from the document under the cursor', () => {
    const lines = text.split('\n');
    // A blank line inside the Workload's container, below its image.
    const edited = TextDocument.create(file.uri, 'yaml', 2, [...lines.slice(0, 21), '    ', ...lines.slice(21)].join('\n'));
    const position = { line: 21, character: 4 };
    const { document, kind } = documentAt(edited, edited.offsetAt(position));
    expect(kind).toBe('Workload');
    const labels = getCompletionItems(document, position, schemas.Workload!, {}, kind).map((i) => i.label);
    expect(labels).toEqual(expect.arrayContaining(['env', 'command', 'args']));
    expect(labels).not.toContain('image');
  });

  it('outline one entry per document, named by kind and name', () => {
    expect(getDocumentSymbols(file).map((s) => s.name)).toEqual(['Component api', 'Workload api']);
  });

  it('leave single-document files as they are', () => {
    const single = TextDocument.create('file:///p.yaml', 'yaml', 1, 'apiVersion: openchoreo.dev/v1alpha1\nkind: Project\n');
    expect(isolatedDocuments(single)[0].document).toBe(single);
  });
});

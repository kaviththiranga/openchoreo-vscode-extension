// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { getCompletionItems } from '../completion/completionProvider';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { loadSchemas, type JsonSchema } from '../schemas/schemaLoader';

const testSchema: JsonSchema = {
  type: 'object',
  properties: {
    apiVersion: { type: 'string', const: 'openchoreo.dev/v1alpha1' },
    kind: { type: 'string', const: 'ComponentType' },
    metadata: { type: 'object' },
    spec: {
      type: 'object',
      properties: {
        workloadType: {
          type: 'string',
          enum: ['deployment', 'statefulset', 'cronjob', 'job', 'proxy'],
          description: 'Type of Kubernetes workload',
        },
        allowedWorkflows: {
          type: 'array',
          description: 'Allowed build workflows',
          items: { type: 'object' },
        },
        schema: {
          type: 'object',
          description: 'Schema definitions',
          properties: {
            parameters: {
              type: 'object',
              description: 'Developer-facing parameters',
              additionalProperties: true,
            },
          },
        },
        resources: {
          type: 'array',
          description: 'Resource templates',
          items: { type: 'object' },
        },
      },
      required: ['workloadType', 'resources'],
    },
  },
};

function createDocument(text: string): TextDocument {
  return TextDocument.create('test://test.yaml', 'yaml', 1, text);
}

describe('getCompletionItems', () => {
  it('provides spec-level completions', () => {
    const text = `apiVersion: openchoreo.dev/v1alpha1
kind: ComponentType
metadata:
  name: test
spec:
  `;
    const doc = createDocument(text);
    const items = getCompletionItems(
      doc,
      { line: 5, character: 2 },
      testSchema,
    );

    const labels = items.map((i) => i.label);
    expect(labels).toContain('workloadType');
    expect(labels).toContain('resources');
    expect(labels).toContain('allowedWorkflows');
    expect(labels).toContain('schema');
  });

  it('provides enum values for workloadType', () => {
    const text = `apiVersion: openchoreo.dev/v1alpha1
kind: ComponentType
spec:
  workloadType: `;
    const doc = createDocument(text);
    const items = getCompletionItems(
      doc,
      { line: 3, character: 16 },
      testSchema,
    );

    const labels = items.map((i) => i.label);
    expect(labels).toContain('deployment');
    expect(labels).toContain('statefulset');
    expect(labels).toContain('cronjob');
  });
});

describe('nested keys', () => {
  const schemas = loadSchemas(path.resolve(__dirname, '../../../../schemas'));
  const labels = (textWithCursor: string) => {
    const offset = textWithCursor.indexOf('|');
    const doc = TextDocument.create('file:///c.yaml', 'yaml', 1, textWithCursor.replace('|', ''));
    return getCompletionItems(doc, doc.positionAt(offset), schemas.Component!, {}, 'Component');
  };
  const head = ['apiVersion: openchoreo.dev/v1alpha1', 'kind: Component', 'metadata:', '  name: api', 'spec:'];

  it('offer kind below the root', () => {
    expect(labels([...head, '  componentType:', '    |'].join('\n')).map((i) => i.label)).toEqual(['kind', 'name']);
  });

  it('offer the other keys of an array item after its first key', () => {
    const items = labels([...head, '  traits:', '    - name: storage', '      |'].join('\n')).map((i) => i.label);
    expect(items).toEqual(expect.arrayContaining(['instanceName', 'kind', 'parameters']));
    expect(items).not.toContain('name');
  });

  it('leave the indentation of an object key snippet to the editor', () => {
    const item = labels([...head, '  |'].join('\n')).find((i) => i.label === 'componentType');
    expect(item?.insertText).toBe('componentType:\n  $0');
  });
});

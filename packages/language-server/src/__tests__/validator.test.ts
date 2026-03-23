// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { validateDocument } from '../validation/validator';
import type { JsonSchema } from '../schemas/schemaLoader';

function createDoc(content: string): TextDocument {
  return TextDocument.create('test://test.yaml', 'yaml', 1, content);
}

const testSchema: JsonSchema = {
  type: 'object',
  properties: {
    apiVersion: { type: 'string', const: 'openchoreo.dev/v1alpha1' },
    kind: { type: 'string', const: 'TestResource' },
    metadata: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 },
        namespace: { type: 'string' },
      },
      required: ['name'],
    },
    spec: {
      type: 'object',
      properties: {
        replicas: { type: 'integer', minimum: 0, maximum: 100 },
        enabled: { type: 'boolean' },
        mode: { type: 'string', enum: ['fast', 'slow', 'balanced'] },
        label: { type: 'string', maxLength: 10, pattern: '^[a-z]+$' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', minLength: 1 },
              weight: { type: 'number' },
            },
            required: ['name'],
          },
          minItems: 1,
        },
      },
      required: ['replicas'],
    },
  },
  required: ['apiVersion', 'kind', 'metadata', 'spec'],
};

describe('validateDocument', () => {
  it('reports no errors for valid document', () => {
    const yaml = `apiVersion: openchoreo.dev/v1alpha1
kind: TestResource
metadata:
  name: my-resource
spec:
  replicas: 3
  enabled: true
  mode: fast`;

    const doc = createDoc(yaml);
    const diagnostics = validateDocument(yaml, testSchema, doc);
    expect(diagnostics).toHaveLength(0);
  });

  it('reports missing required property', () => {
    const yaml = `apiVersion: openchoreo.dev/v1alpha1
kind: TestResource
metadata:
  name: test
spec:
  enabled: true`;

    const doc = createDoc(yaml);
    const diagnostics = validateDocument(yaml, testSchema, doc);
    const missing = diagnostics.filter((d) => d.message.includes('Missing required property "replicas"'));
    expect(missing.length).toBe(1);
    expect(missing[0].severity).toBe(DiagnosticSeverity.Error);
  });

  it('reports const violation', () => {
    const yaml = `apiVersion: wrong-version
kind: TestResource
metadata:
  name: test
spec:
  replicas: 1`;

    const doc = createDoc(yaml);
    const diagnostics = validateDocument(yaml, testSchema, doc);
    const constErr = diagnostics.filter((d) => d.message.includes("Value must be 'openchoreo.dev/v1alpha1'"));
    expect(constErr.length).toBe(1);
    expect(constErr[0].severity).toBe(DiagnosticSeverity.Error);
  });

  it('reports enum violation', () => {
    const yaml = `apiVersion: openchoreo.dev/v1alpha1
kind: TestResource
metadata:
  name: test
spec:
  replicas: 1
  mode: invalid`;

    const doc = createDoc(yaml);
    const diagnostics = validateDocument(yaml, testSchema, doc);
    const enumErr = diagnostics.filter((d) => d.message.includes('Value must be one of'));
    expect(enumErr.length).toBe(1);
    expect(enumErr[0].message).toContain('fast');
  });

  it('reports type mismatch — string where integer expected', () => {
    const yaml = `apiVersion: openchoreo.dev/v1alpha1
kind: TestResource
metadata:
  name: test
spec:
  replicas: "not-a-number"`;

    const doc = createDoc(yaml);
    const diagnostics = validateDocument(yaml, testSchema, doc);
    const typeErr = diagnostics.filter((d) => d.message.includes("Expected type 'integer'"));
    expect(typeErr.length).toBe(1);
  });

  it('reports type mismatch — string where boolean expected', () => {
    const yaml = `apiVersion: openchoreo.dev/v1alpha1
kind: TestResource
metadata:
  name: test
spec:
  replicas: 1
  enabled: "not-a-boolean"`;

    const doc = createDoc(yaml);
    const diagnostics = validateDocument(yaml, testSchema, doc);
    const typeErr = diagnostics.filter((d) => d.message.includes("Expected type 'boolean'"));
    expect(typeErr.length).toBe(1);
  });

  it('reports number out of range', () => {
    const yaml = `apiVersion: openchoreo.dev/v1alpha1
kind: TestResource
metadata:
  name: test
spec:
  replicas: 200`;

    const doc = createDoc(yaml);
    const diagnostics = validateDocument(yaml, testSchema, doc);
    const rangeErr = diagnostics.filter((d) => d.message.includes('Value must be <= 100'));
    expect(rangeErr.length).toBe(1);
    expect(rangeErr[0].severity).toBe(DiagnosticSeverity.Warning);
  });

  it('reports string minLength violation', () => {
    const yaml = `apiVersion: openchoreo.dev/v1alpha1
kind: TestResource
metadata:
  name: ""
spec:
  replicas: 1`;

    const doc = createDoc(yaml);
    const diagnostics = validateDocument(yaml, testSchema, doc);
    const minErr = diagnostics.filter((d) => d.message.includes('at least 1 character'));
    expect(minErr.length).toBe(1);
  });

  it('reports string maxLength violation', () => {
    const yaml = `apiVersion: openchoreo.dev/v1alpha1
kind: TestResource
metadata:
  name: test
spec:
  replicas: 1
  label: verylongstringvalue`;

    const doc = createDoc(yaml);
    const diagnostics = validateDocument(yaml, testSchema, doc);
    const maxErr = diagnostics.filter((d) => d.message.includes('at most 10 characters'));
    expect(maxErr.length).toBe(1);
  });

  it('reports string pattern violation', () => {
    const yaml = `apiVersion: openchoreo.dev/v1alpha1
kind: TestResource
metadata:
  name: test
spec:
  replicas: 1
  label: ABC123`;

    const doc = createDoc(yaml);
    const diagnostics = validateDocument(yaml, testSchema, doc);
    const patternErr = diagnostics.filter((d) => d.message.includes('must match pattern'));
    expect(patternErr.length).toBe(1);
  });

  it('validates array items — missing required field', () => {
    const yaml = `apiVersion: openchoreo.dev/v1alpha1
kind: TestResource
metadata:
  name: test
spec:
  replicas: 1
  items:
    - weight: 5`;

    const doc = createDoc(yaml);
    const diagnostics = validateDocument(yaml, testSchema, doc);
    const missingName = diagnostics.filter((d) => d.message.includes('Missing required property "name"'));
    expect(missingName.length).toBe(1);
  });

  it('validates array minItems', () => {
    const yaml = `apiVersion: openchoreo.dev/v1alpha1
kind: TestResource
metadata:
  name: test
spec:
  replicas: 1
  items: []`;

    const doc = createDoc(yaml);
    const diagnostics = validateDocument(yaml, testSchema, doc);
    const minErr = diagnostics.filter((d) => d.message.includes('at least 1 item'));
    expect(minErr.length).toBe(1);
  });

  it('reports YAML syntax errors', () => {
    const yaml = `apiVersion: openchoreo.dev/v1alpha1
kind: TestResource
metadata:
  name: test
spec:
  replicas: [invalid`;

    const doc = createDoc(yaml);
    const diagnostics = validateDocument(yaml, testSchema, doc);
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import {
  Diagnostic,
  DiagnosticSeverity,
  Range,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseDocument, isMap, isScalar, isPair, YAMLMap, Pair, Scalar } from 'yaml';
import type { JsonSchema } from '../schemas/schemaLoader';

/**
 * Validate a YAML document against a JSON Schema.
 * Returns diagnostics for validation errors.
 */
export function validateDocument(
  text: string,
  schema: JsonSchema,
  textDocument: TextDocument,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  try {
    const doc = parseDocument(text, { keepSourceTokens: true });

    // Check for YAML parse errors
    for (const error of doc.errors) {
      const pos = error.pos?.[0] ?? 0;
      const endPos = error.pos?.[1] ?? pos;
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: textDocument.positionAt(pos),
          end: textDocument.positionAt(endPos),
        },
        message: error.message,
        source: 'openchoreo',
      });
    }

    // Schema-based validation
    if (doc.contents && isMap(doc.contents) && schema.properties) {
      validateObject(
        doc.contents,
        schema,
        textDocument,
        diagnostics,
        [],
      );
    }
  } catch (error) {
    // If YAML parsing completely fails, add a single diagnostic
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
      message: `YAML parse error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      source: 'openchoreo',
    });
  }

  return diagnostics;
}

function validateObject(
  node: YAMLMap,
  schema: JsonSchema,
  textDocument: TextDocument,
  diagnostics: Diagnostic[],
  path: string[],
): void {
  if (!schema.properties) {
    return;
  }

  // Check for unknown properties (if additionalProperties is false)
  if (schema.additionalProperties === false) {
    for (const item of node.items) {
      if (isPair(item) && isScalar(item.key)) {
        const key = String(item.key.value);
        if (
          !schema.properties[key] &&
          key !== 'apiVersion' &&
          key !== 'kind' &&
          key !== 'metadata' &&
          key !== 'status'
        ) {
          const range = getKeyRange(item.key, textDocument);
          if (range) {
            diagnostics.push({
              severity: DiagnosticSeverity.Warning,
              range,
              message: `Unknown property "${key}" in ${path.length > 0 ? path.join('.') : 'root'}`,
              source: 'openchoreo',
            });
          }
        }
      }
    }
  }

  // Check required properties
  if (schema.required) {
    for (const requiredKey of schema.required) {
      const hasKey = node.items.some(
        (item) =>
          isPair(item) &&
          isScalar(item.key) &&
          String(item.key.value) === requiredKey,
      );
      if (!hasKey) {
        // Report at the first line of the object
        const firstItem = node.items[0];
        if (firstItem && isPair(firstItem) && isScalar(firstItem.key)) {
          const range = getKeyRange(firstItem.key, textDocument);
          if (range) {
            diagnostics.push({
              severity: DiagnosticSeverity.Error,
              range,
              message: `Missing required property "${requiredKey}"`,
              source: 'openchoreo',
            });
          }
        }
      }
    }
  }

  // Recursively validate nested objects
  for (const item of node.items) {
    if (isPair(item) && isScalar(item.key) && isMap(item.value)) {
      const key = String(item.key.value);
      const propSchema = schema.properties[key];
      if (propSchema && propSchema.type === 'object' && propSchema.properties) {
        validateObject(
          item.value,
          propSchema,
          textDocument,
          diagnostics,
          [...path, key],
        );
      }
    }
  }
}

function getKeyRange(
  scalar: Scalar,
  textDocument: TextDocument,
): Range | undefined {
  const range = scalar.range;
  if (!range || range.length < 2) {
    return undefined;
  }
  return {
    start: textDocument.positionAt(range[0]),
    end: textDocument.positionAt(range[1]),
  };
}

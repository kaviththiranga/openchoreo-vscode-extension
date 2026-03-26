// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import {
  Diagnostic,
  DiagnosticSeverity,
  Range,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  parseDocument,
  isMap,
  isScalar,
  isSeq,
  isPair,
  YAMLMap,
  YAMLSeq,
  Scalar,
  Node,
} from 'yaml';
import type { JsonSchema } from '../schemas/schemaLoader';
import { validateReferences } from './referenceValidator';
import { containsCelExpression, validateCelExpressions } from './celValidator';

/** K8s envelope fields that are always allowed at root level. */
const K8S_ENVELOPE_KEYS = new Set(['apiVersion', 'kind', 'metadata', 'status']);

/**
 * Validate a YAML document against a JSON Schema.
 * Returns diagnostics for validation errors.
 */
export function validateDocument(
  text: string,
  schema: JsonSchema,
  textDocument: TextDocument,
  resourceNames: Record<string, string[]> = {},
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
        true,
      );

      // Cross-resource reference validation
      if (Object.keys(resourceNames).length > 0) {
        validateReferences(
          doc.contents,
          schema,
          textDocument,
          resourceNames,
          diagnostics,
          [],
        );
      }
    }
  } catch (error) {
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
  isRoot = false,
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
          !(isRoot && K8S_ENVELOPE_KEYS.has(key))
        ) {
          const range = getNodeRange(item.key, textDocument);
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
        const firstItem = node.items[0];
        if (firstItem && isPair(firstItem) && isScalar(firstItem.key)) {
          const range = getNodeRange(firstItem.key, textDocument);
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

  // Validate each property's value
  for (const item of node.items) {
    if (!isPair(item) || !isScalar(item.key)) {
      continue;
    }

    const key = String(item.key.value);
    const propSchema = schema.properties[key];
    if (!propSchema) {
      continue;
    }

    validateValue(
      item.key as Scalar,
      item.value as Node | null,
      propSchema,
      textDocument,
      diagnostics,
      [...path, key],
    );
  }
}

/**
 * Validate a single YAML value against its schema.
 */
function validateValue(
  keyNode: Scalar,
  valueNode: Node | null,
  schema: JsonSchema,
  textDocument: TextDocument,
  diagnostics: Diagnostic[],
  path: string[],
): void {
  if (!valueNode) {
    return;
  }

  // Recurse into objects
  if (isMap(valueNode) && schema.type === 'object' && schema.properties) {
    validateObject(valueNode, schema, textDocument, diagnostics, path);
    return;
  }

  // Validate arrays
  if (isSeq(valueNode) && schema.type === 'array') {
    validateArray(valueNode, schema, textDocument, diagnostics, path);
    return;
  }

  // Scalar value validation
  if (isScalar(valueNode)) {
    const value = valueNode.value;
    const range = getNodeRange(valueNode, textDocument) ?? getNodeRange(keyNode, textDocument);
    if (!range) {
      return;
    }

    // CEL expressions — skip type checks, validate CEL syntax instead
    if (typeof value === 'string' && containsCelExpression(value)) {
      validateCelExpressions(value, range, diagnostics);
      return;
    }

    // Type check
    if (schema.type) {
      const typeError = checkType(value, schema.type);
      if (typeError) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range,
          message: typeError,
          source: 'openchoreo',
        });
        return; // Skip further checks if type is wrong
      }
    }

    // Const check
    if (schema.const !== undefined && value !== schema.const) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range,
        message: `Value must be '${schema.const}'`,
        source: 'openchoreo',
      });
      return;
    }

    // Enum check
    if (schema.enum && !schema.enum.includes(value as string | number | boolean)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range,
        message: `Value must be one of: ${schema.enum.join(', ')}`,
        source: 'openchoreo',
      });
      return;
    }

    // String constraints
    if (typeof value === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range,
          message: `String must be at least ${schema.minLength} character${schema.minLength === 1 ? '' : 's'}`,
          source: 'openchoreo',
        });
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range,
          message: `String must be at most ${schema.maxLength} characters`,
          source: 'openchoreo',
        });
      }
      if (schema.pattern) {
        try {
          if (!new RegExp(schema.pattern).test(value)) {
            diagnostics.push({
              severity: DiagnosticSeverity.Warning,
              range,
              message: `String must match pattern: ${schema.pattern}`,
              source: 'openchoreo',
            });
          }
        } catch {
          // Invalid regex in schema — skip
        }
      }
    }

    // Number constraints
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range,
          message: `Value must be >= ${schema.minimum}`,
          source: 'openchoreo',
        });
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range,
          message: `Value must be <= ${schema.maximum}`,
          source: 'openchoreo',
        });
      }
    }
  }

  // Type mismatch for non-scalar values
  if (schema.type === 'object' && !isMap(valueNode) && isScalar(valueNode)) {
    const range = getNodeRange(valueNode, textDocument);
    if (range) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range,
        message: `Expected an object but got a scalar value`,
        source: 'openchoreo',
      });
    }
  }

  if (schema.type === 'array' && !isSeq(valueNode) && isScalar(valueNode)) {
    const range = getNodeRange(valueNode, textDocument);
    if (range) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range,
        message: `Expected an array but got a scalar value`,
        source: 'openchoreo',
      });
    }
  }
}

/**
 * Validate array items against the items schema.
 */
function validateArray(
  node: YAMLSeq,
  schema: JsonSchema,
  textDocument: TextDocument,
  diagnostics: Diagnostic[],
  path: string[],
): void {
  // Array length constraints
  if (schema.minItems !== undefined && node.items.length < schema.minItems) {
    const range = getSeqRange(node, textDocument);
    if (range) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range,
        message: `Array must have at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}`,
        source: 'openchoreo',
      });
    }
  }

  if (schema.maxItems !== undefined && node.items.length > schema.maxItems) {
    const range = getSeqRange(node, textDocument);
    if (range) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range,
        message: `Array must have at most ${schema.maxItems} items`,
        source: 'openchoreo',
      });
    }
  }

  // Validate each item against the items schema
  if (schema.items) {
    node.items.forEach((item, index) => {
      const itemPath = [...path, `[${index}]`];

      if (isMap(item) && schema.items!.type === 'object') {
        validateObject(
          item,
          schema.items!,
          textDocument,
          diagnostics,
          itemPath,
        );
      } else if (isScalar(item) && schema.items!.type) {
        // Create a synthetic key node for error reporting on the item value
        const range = getNodeRange(item, textDocument);
        if (range && schema.items!.type) {
          const typeError = checkType(item.value, schema.items!.type);
          if (typeError) {
            diagnostics.push({
              severity: DiagnosticSeverity.Error,
              range,
              message: typeError,
              source: 'openchoreo',
            });
          }
        }
      }
    });
  }
}

/**
 * Check if a value matches the expected JSON Schema type.
 * Returns an error message if mismatched, or undefined if OK.
 */
function checkType(value: unknown, expectedType: string): string | undefined {
  switch (expectedType) {
    case 'string':
      if (typeof value !== 'string') {
        return `Expected type 'string' but got '${typeof value}'`;
      }
      break;
    case 'number':
    case 'integer':
      if (typeof value !== 'number') {
        return `Expected type '${expectedType}' but got '${typeof value}'`;
      }
      if (expectedType === 'integer' && !Number.isInteger(value)) {
        return `Expected an integer but got a decimal number`;
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') {
        return `Expected type 'boolean' but got '${typeof value}'`;
      }
      break;
    default:
      break;
  }
  return undefined;
}

function getNodeRange(
  node: Scalar | Node,
  textDocument: TextDocument,
): Range | undefined {
  const range = (node as Scalar).range;
  if (!range || range.length < 2) {
    return undefined;
  }
  return {
    start: textDocument.positionAt(range[0]),
    end: textDocument.positionAt(range[1]),
  };
}

function getSeqRange(
  node: YAMLSeq,
  textDocument: TextDocument,
): Range | undefined {
  const range = node.range;
  if (!range || range.length < 2) {
    return undefined;
  }
  return {
    start: textDocument.positionAt(range[0]),
    end: textDocument.positionAt(range[1]),
  };
}

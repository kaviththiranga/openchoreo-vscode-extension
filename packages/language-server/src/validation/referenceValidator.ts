// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import {
  Diagnostic,
  DiagnosticSeverity,
  Range,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  isMap,
  isScalar,
  isPair,
  YAMLMap,
  Scalar,
} from 'yaml';
import type { JsonSchema } from '../schemas/schemaLoader';

/**
 * Validate resource references (fields with x-openchoreo-ref) against
 * the cached resource names from the cluster.
 */
export function validateReferences(
  node: YAMLMap,
  schema: JsonSchema,
  textDocument: TextDocument,
  resourceNames: Record<string, string[]>,
  diagnostics: Diagnostic[],
  path: string[],
): void {
  if (!schema.properties) {
    return;
  }

  for (const item of node.items) {
    if (!isPair(item) || !isScalar(item.key)) {
      continue;
    }

    const key = String(item.key.value);
    const propSchema = schema.properties[key];
    if (!propSchema) {
      continue;
    }

    // Check for x-openchoreo-ref on scalar values
    if (propSchema['x-openchoreo-ref'] && isScalar(item.value) && item.value.value) {
      const refKind = propSchema['x-openchoreo-ref'];
      const value = String(item.value.value);
      const kinds = refKind.split('+');
      const allNames = kinds.flatMap((k) => resourceNames[k] ?? []);

      // Only validate if we have names for at least one of the referenced kinds
      const hasAnyNames = kinds.some((k) => (resourceNames[k]?.length ?? 0) > 0);

      if (hasAnyNames && !allNames.includes(value)) {
        const range = getRange(item.value as Scalar, textDocument);
        if (range) {
          const kindLabel = kinds.join(' or ');
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range,
            message: `${kindLabel} '${value}' not found in current namespace`,
            source: 'openchoreo',
          });
        }
      }
    }

    // Recurse into objects
    if (isMap(item.value) && propSchema.type === 'object' && propSchema.properties) {
      validateReferences(
        item.value,
        propSchema,
        textDocument,
        resourceNames,
        diagnostics,
        [...path, key],
      );
    }

    // Recurse into array items
    if (isMap(item.value) && propSchema.type === 'array' && propSchema.items?.properties) {
      // This handles the case where the array value is directly a map (single item)
    }
  }

  // Handle array items recursively
  for (const item of node.items) {
    if (!isPair(item) || !isScalar(item.key)) continue;

    const key = String(item.key.value);
    const propSchema = schema.properties[key];

    if (propSchema?.type === 'array' && propSchema.items) {
      const seqNode = item.value;
      if (seqNode && typeof seqNode === 'object' && 'items' in (seqNode as object) && Array.isArray((seqNode as { items: unknown[] }).items)) {
        for (const arrayItem of (seqNode as { items: unknown[] }).items) {
          if (isMap(arrayItem) && propSchema.items.properties) {
            validateReferences(
              arrayItem,
              propSchema.items,
              textDocument,
              resourceNames,
              diagnostics,
              [...path, key, '[]'],
            );
          }
        }
      }
    }
  }
}

function getRange(scalar: Scalar, textDocument: TextDocument): Range | undefined {
  const range = scalar.range;
  if (!range || range.length < 2) return undefined;
  return {
    start: textDocument.positionAt(range[0]),
    end: textDocument.positionAt(range[1]),
  };
}

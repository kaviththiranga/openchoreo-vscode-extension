// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { Hover, Position, MarkupKind } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { isMap, isPair, isScalar, isSeq, parseDocument } from 'yaml';
import type { JsonSchema } from '../schemas/schemaLoader';

/**
 * Provide hover documentation for CRD fields.
 */
export function getHoverInfo(
  document: TextDocument,
  position: Position,
  schema: JsonSchema,
): Hover | null {
  const yamlPath = keyPathAt(document.getText(), document.offsetAt(position));
  if (!yamlPath) {
    return null;
  }

  const fieldSchema = resolveSchemaAtPath(schema, yamlPath);
  if (!fieldSchema) {
    return null;
  }

  // Build hover markdown
  const parts: string[] = [];

  // Type info
  const typeStr = formatType(fieldSchema);
  parts.push(`**${formatPath(yamlPath)}**: \`${typeStr}\``);

  // Description
  if (fieldSchema.description) {
    parts.push('', fieldSchema.description);
  }

  // Constraints
  const constraints = getConstraints(fieldSchema);
  if (constraints.length > 0) {
    parts.push('', '**Constraints:**');
    for (const c of constraints) {
      parts.push(`- ${c}`);
    }
  }

  // Default value
  if (fieldSchema.default !== undefined) {
    parts.push('', `**Default:** \`${JSON.stringify(fieldSchema.default)}\``);
  }

  // Enum values
  if (fieldSchema.enum) {
    parts.push('', `**Allowed values:** ${fieldSchema.enum.map((v) => `\`${v}\``).join(', ')}`);
  }

  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: parts.join('\n'),
    },
  };
}

type YamlPath = (string | number)[];

/**
 * The path from the document root to the mapping key at `offset`, with list
 * items as their index, or undefined when the offset is not on a key.
 */
function keyPathAt(text: string, offset: number): YamlPath | undefined {
  const visit = (node: unknown, path: YamlPath): YamlPath | undefined => {
    if (isMap(node)) {
      for (const pair of node.items) {
        if (!isPair(pair) || !isScalar(pair.key)) continue;
        const key = String(pair.key.value);
        const range = pair.key.range;
        if (range && offset >= range[0] && offset <= range[1]) return [...path, key];
        const hit = visit(pair.value, [...path, key]);
        if (hit) return hit;
      }
    } else if (isSeq(node)) {
      for (let i = 0; i < node.items.length; i++) {
        const hit = visit(node.items[i], [...path, i]);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  try {
    return visit(parseDocument(text).contents, []);
  } catch {
    return undefined;
  }
}

/** `spec.traits[].name` style. */
function formatPath(path: YamlPath): string {
  return path.reduce<string>((out, step) => (typeof step === 'number' ? `${out}[]` : out ? `${out}.${step}` : step), '');
}

function resolveSchemaAtPath(
  schema: JsonSchema,
  path: YamlPath,
): JsonSchema | undefined {
  let current: JsonSchema = schema;

  for (const step of path) {
    const next = typeof step === 'number' ? current.items : current.properties?.[step];
    if (!next) return undefined;
    current = next;
  }

  return current;
}

function formatType(schema: JsonSchema): string {
  if (schema.enum) {
    return schema.enum.map(String).join(' | ');
  }
  if (schema.type === 'array' && schema.items) {
    return `${formatType(schema.items)}[]`;
  }
  return schema.type ?? 'any';
}

function getConstraints(schema: JsonSchema): string[] {
  const constraints: string[] = [];

  if (schema.minLength !== undefined) {
    constraints.push(`Minimum length: ${schema.minLength}`);
  }
  if (schema.maxLength !== undefined) {
    constraints.push(`Maximum length: ${schema.maxLength}`);
  }
  if (schema.minimum !== undefined) {
    constraints.push(`Minimum: ${schema.minimum}`);
  }
  if (schema.maximum !== undefined) {
    constraints.push(`Maximum: ${schema.maximum}`);
  }
  if (schema.pattern) {
    constraints.push(`Pattern: \`${schema.pattern}\``);
  }

  return constraints;
}

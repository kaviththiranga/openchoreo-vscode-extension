// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { Hover, Position, MarkupKind } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { JsonSchema } from '../schemas/schemaLoader';

/**
 * Provide hover documentation for CRD fields.
 */
export function getHoverInfo(
  document: TextDocument,
  position: Position,
  schema: JsonSchema,
): Hover | null {
  const text = document.getText();
  const lines = text.split('\n');
  const currentLine = lines[position.line];
  if (!currentLine) {
    return null;
  }

  // Extract the key at cursor position
  const keyMatch = currentLine.match(/^\s*(\w[\w.-]*):/);
  if (!keyMatch) {
    return null;
  }

  const key = keyMatch[1];
  const keyStart = currentLine.indexOf(key);
  const keyEnd = keyStart + key.length;

  // Check if cursor is on the key
  if (position.character < keyStart || position.character > keyEnd) {
    return null;
  }

  // Resolve the YAML path to find the schema for this key
  const yamlPath = resolveYamlPathForHover(lines, position.line);
  yamlPath.push(key);

  const fieldSchema = resolveSchemaAtPath(schema, yamlPath);
  if (!fieldSchema) {
    return null;
  }

  // Build hover markdown
  const parts: string[] = [];

  // Type info
  const typeStr = formatType(fieldSchema);
  parts.push(`**${yamlPath.join('.')}**: \`${typeStr}\``);

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

function resolveYamlPathForHover(
  lines: string[],
  targetLine: number,
): string[] {
  const path: string[] = [];
  const indentStack: number[] = [];

  for (let i = 0; i < targetLine; i++) {
    const line = lines[i];
    if (!line || line.trim() === '' || line.trim().startsWith('#')) {
      continue;
    }

    const indent = line.search(/\S/);
    const keyMatch = line.match(/^\s*(\w[\w.-]*):/);
    if (!keyMatch) {
      continue;
    }

    const key = keyMatch[1];

    while (
      indentStack.length > 0 &&
      indent <= indentStack[indentStack.length - 1]
    ) {
      indentStack.pop();
      path.pop();
    }

    path.push(key);
    indentStack.push(indent);
  }

  return path;
}

function resolveSchemaAtPath(
  schema: JsonSchema,
  path: string[],
): JsonSchema | undefined {
  let current: JsonSchema = schema;

  for (const key of path) {
    if (current.properties && current.properties[key]) {
      current = current.properties[key];
    } else {
      return undefined;
    }
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

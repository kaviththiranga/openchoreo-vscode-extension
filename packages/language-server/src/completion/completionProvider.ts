// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import {
  CompletionItem,
  CompletionItemKind,
  Position,
  InsertTextFormat,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseDocument, isMap, isScalar, isPair } from 'yaml';
import type { JsonSchema } from '../schemas/schemaLoader';

/**
 * Provide completion items based on the current cursor position
 * and the CRD's JSON Schema.
 */
export function getCompletionItems(
  document: TextDocument,
  position: Position,
  schema: JsonSchema,
): CompletionItem[] {
  const text = document.getText();
  const lines = text.split('\n');
  const currentLine = lines[position.line] ?? '';

  // Calculate indentation level to determine context
  // Use cursor position as effective indent for empty/whitespace-only lines
  const firstNonSpace = currentLine.search(/\S/);
  const indent = firstNonSpace < 0 ? position.character : firstNonSpace;

  // Determine the YAML path at the current position by walking indentation
  const yamlPath = resolveYamlPath(lines, position.line);
  const contextSchema = resolveSchemaAtPath(schema, yamlPath);

  if (!contextSchema) {
    return [];
  }

  // Check if we're completing a value (after ":") or a key
  const colonIndex = currentLine.indexOf(':');
  if (colonIndex >= 0 && position.character > colonIndex) {
    // Value completion — find the schema for the specific key on this line
    const keyMatch = currentLine.match(/^\s*(\w[\w.-]*):/);
    if (keyMatch && contextSchema.properties) {
      const fieldSchema = contextSchema.properties[keyMatch[1]];
      if (fieldSchema) {
        return getValueCompletions(fieldSchema);
      }
    }
    return [];
  }

  // Key completion
  return getPropertyCompletions(contextSchema, indent);
}

function getPropertyCompletions(
  schema: JsonSchema,
  indent: number,
): CompletionItem[] {
  if (!schema.properties) {
    return [];
  }

  const items: CompletionItem[] = [];
  const indentStr = ' '.repeat(indent);

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    // Skip standard k8s fields
    if (['apiVersion', 'kind', 'metadata', 'status'].includes(key)) {
      continue;
    }

    const item: CompletionItem = {
      label: key,
      kind: CompletionItemKind.Property,
      detail: formatSchemaType(propSchema),
      documentation: propSchema.description,
      insertTextFormat: InsertTextFormat.Snippet,
    };

    // Generate smart insert text based on type
    if (propSchema.type === 'object' && propSchema.properties) {
      item.insertText = `${key}:\n${indentStr}  $0`;
    } else if (propSchema.type === 'array') {
      item.insertText = `${key}:\n${indentStr}  - $0`;
    } else if (propSchema.type === 'boolean') {
      item.insertText = `${key}: \${1|true,false|}`;
    } else if (propSchema.enum) {
      const enumValues = propSchema.enum.join(',');
      item.insertText = `${key}: \${1|${enumValues}|}`;
    } else {
      item.insertText = `${key}: $0`;
    }

    items.push(item);
  }

  return items;
}

function getValueCompletions(schema: JsonSchema): CompletionItem[] {
  const items: CompletionItem[] = [];

  if (schema.enum) {
    for (const value of schema.enum) {
      items.push({
        label: String(value),
        kind: CompletionItemKind.EnumMember,
        detail: 'Enum value',
      });
    }
  }

  if (schema.type === 'boolean') {
    items.push(
      { label: 'true', kind: CompletionItemKind.Value },
      { label: 'false', kind: CompletionItemKind.Value },
    );
  }

  if (schema.default !== undefined) {
    items.push({
      label: String(schema.default),
      kind: CompletionItemKind.Value,
      detail: 'Default value',
    });
  }

  return items;
}

/**
 * Resolve the YAML key path at a given line by tracking indentation.
 */
function resolveYamlPath(lines: string[], targetLine: number): string[] {
  const path: string[] = [];
  const indentStack: number[] = [];

  for (let i = 0; i <= targetLine; i++) {
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

    // Pop path entries for equal or lesser indentation
    while (indentStack.length > 0 && indent <= indentStack[indentStack.length - 1]) {
      indentStack.pop();
      path.pop();
    }

    if (i < targetLine) {
      path.push(key);
      indentStack.push(indent);
    }
  }

  return path;
}

/**
 * Walk a JSON Schema following a YAML path to find the contextual schema.
 */
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

function formatSchemaType(schema: JsonSchema): string {
  if (schema.enum) {
    return `enum: ${schema.enum.join(' | ')}`;
  }
  if (schema.type === 'array' && schema.items) {
    return `${formatSchemaType(schema.items)}[]`;
  }
  return schema.type ?? 'any';
}

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import {
  CompletionItem,
  CompletionItemKind,
  Position,
  InsertTextFormat,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { JsonSchema } from '../schemas/schemaLoader';
import { OPENCHOREO_CRD_KINDS, type CrdKind } from '../validation/crdDetector';
import { isInsideCelExpression, getCelCompletionItems } from './celCompletions';

/** Common OpenChoreo labels offered as key completions inside metadata.labels. */
const COMMON_LABELS = [
  'openchoreo.dev/project',
  'openchoreo.dev/component',
  'openchoreo.dev/environment',
  'app.kubernetes.io/name',
  'app.kubernetes.io/part-of',
  'app.kubernetes.io/managed-by',
];

/** Common OpenChoreo annotations offered as key completions inside metadata.annotations. */
const COMMON_ANNOTATIONS = [
  'openchoreo.dev/description',
];

/** CRD scaffold templates offered when the document is empty. */
const SCAFFOLD_KINDS = [
  'Project', 'Component', 'ComponentType', 'Trait', 'Environment',
  'DataPlane', 'Workflow', 'Workload', 'DeploymentPipeline', 'SecretReference',
];

/**
 * Provide completion items based on the current cursor position
 * and the CRD's JSON Schema.
 */
export function getCompletionItems(
  document: TextDocument,
  position: Position,
  schema: JsonSchema | null,
  resourceNames: Record<string, string[]> = {},
  crdKind?: string,
): CompletionItem[] {
  const text = document.getText();
  const lines = text.split('\n');
  const currentLine = lines[position.line] ?? '';

  // CEL expression completions — detect if cursor is inside ${...}
  const celDetected = isInsideCelExpression(currentLine, position.character);
  if (celDetected) {
    return getCelCompletionItems(currentLine, position.character, crdKind ?? '', position.line);
  }

  // Empty document → offer CRD scaffold completions
  if (text.trim() === '' || (lines.length <= 2 && text.trim().length < 5)) {
    return getScaffoldCompletions();
  }

  // If no schema matched (not a recognized CRD yet), offer apiVersion/kind bootstrap
  if (!schema) {
    return getBootstrapCompletions(text, currentLine, position);
  }

  const firstNonSpace = currentLine.search(/\S/);
  const indent = firstNonSpace < 0 ? position.character : firstNonSpace;

  const yamlPath = resolveYamlPath(lines, position.line);

  // Special: inside metadata.labels or metadata.annotations → offer common keys
  if (yamlPath.length >= 2) {
    const parent = yamlPath.slice(-1)[0];
    const grandparent = yamlPath.slice(-2)[0];
    if (grandparent === 'metadata' && (parent === 'labels' || parent === 'annotations')) {
      const colonIndex = currentLine.indexOf(':');
      if (colonIndex < 0 || position.character <= colonIndex) {
        return getLabelAnnotationKeyCompletions(parent);
      }
    }
  }

  const contextSchema = resolveSchemaAtPath(schema, yamlPath);
  if (!contextSchema) {
    return [];
  }

  // Check if we're completing a value (after ":") or a key
  const colonIndex = currentLine.indexOf(':');
  if (colonIndex >= 0 && position.character > colonIndex) {
    const keyMatch = currentLine.match(/^\s*(?:-\s+)?(\w[\w.-]*):/);
    if (keyMatch) {
      const fieldName = keyMatch[1];

      // Special: kind field at root level → offer all CRD kinds
      if (fieldName === 'kind' && yamlPath.length === 0) {
        return getKindCompletions();
      }

      // Special: apiVersion field → offer known API versions
      if (fieldName === 'apiVersion' && yamlPath.length === 0) {
        return [
          {
            label: 'openchoreo.dev/v1alpha1',
            kind: CompletionItemKind.Value,
            detail: 'OpenChoreo API version',
          },
        ];
      }

      // Look up field in context schema properties, or in array items properties
      const props = contextSchema.properties ??
        (contextSchema.type === 'array' && contextSchema.items?.properties
          ? contextSchema.items.properties : undefined);
      if (props) {
        const fieldSchema = props[fieldName];
        if (fieldSchema) {
          return getValueCompletions(fieldSchema, resourceNames);
        }
      }
    }
    return [];
  }

  // Key completion — if context is an array, offer properties from items schema
  const keySchema = (contextSchema.type === 'array' && contextSchema.items?.properties)
    ? contextSchema.items
    : contextSchema;
  return getPropertyCompletions(keySchema, indent);
}

/**
 * Bootstrap completions for files that don't yet have a recognized CRD.
 * Offers apiVersion and kind to get started.
 */
function getBootstrapCompletions(
  text: string,
  currentLine: string,
  position: Position,
): CompletionItem[] {
  const items: CompletionItem[] = [];
  const colonIndex = currentLine.indexOf(':');

  // If we're after a colon on a kind: line, offer CRD kinds
  if (colonIndex >= 0 && position.character > colonIndex) {
    const keyMatch = currentLine.match(/^\s*kind\s*:/);
    if (keyMatch) {
      return getKindCompletions();
    }
    const apiMatch = currentLine.match(/^\s*apiVersion\s*:/);
    if (apiMatch) {
      return [
        {
          label: 'openchoreo.dev/v1alpha1',
          kind: CompletionItemKind.Value,
          detail: 'OpenChoreo API version',
        },
      ];
    }
    return [];
  }

  // Key completions: offer apiVersion and kind if not present
  if (!text.includes('apiVersion:')) {
    items.push({
      label: 'apiVersion',
      kind: CompletionItemKind.Property,
      detail: 'string',
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: 'apiVersion: openchoreo.dev/v1alpha1',
    });
  }
  if (!text.includes('kind:')) {
    items.push({
      label: 'kind',
      kind: CompletionItemKind.Property,
      detail: 'string',
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: `kind: \${1|${OPENCHOREO_CRD_KINDS.join(',')}|}`,
    });
  }

  return items;
}

/**
 * Offer all OpenChoreo CRD kinds as value completions.
 */
function getKindCompletions(): CompletionItem[] {
  return OPENCHOREO_CRD_KINDS.map((kind) => ({
    label: kind,
    kind: CompletionItemKind.EnumMember,
    detail: 'OpenChoreo CRD',
  }));
}

/**
 * Scaffold completions for empty documents — full CRD templates.
 */
function getScaffoldCompletions(): CompletionItem[] {
  return SCAFFOLD_KINDS.map((kind) => ({
    label: `oc-${kind.toLowerCase()}`,
    kind: CompletionItemKind.Snippet,
    detail: `OpenChoreo ${kind} scaffold`,
    documentation: `Scaffold a new ${kind} resource`,
    insertTextFormat: InsertTextFormat.Snippet,
    insertText: [
      `apiVersion: openchoreo.dev/v1alpha1`,
      `kind: ${kind}`,
      `metadata:`,
      `  name: \${1:my-${kind.toLowerCase()}}`,
      `  namespace: \${2:default}`,
      `spec:`,
      `  $0`,
    ].join('\n'),
    sortText: '0', // Show at top
  }));
}

/**
 * Common label/annotation key completions.
 */
function getLabelAnnotationKeyCompletions(
  section: string,
): CompletionItem[] {
  const keys = section === 'labels' ? COMMON_LABELS : COMMON_ANNOTATIONS;
  return keys.map((key) => ({
    label: key,
    kind: CompletionItemKind.Property,
    detail: section === 'labels' ? 'Common label' : 'Common annotation',
    insertTextFormat: InsertTextFormat.Snippet,
    insertText: `${key}: $0`,
  }));
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
    // Skip standard k8s fields — they're handled separately
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

function getValueCompletions(
  schema: JsonSchema,
  resourceNames: Record<string, string[]> = {},
): CompletionItem[] {
  const items: CompletionItem[] = [];

  // Dynamic resource name completions — supports "Kind1+Kind2" merged refs
  const refKind = schema['x-openchoreo-ref'];
  if (refKind) {
    const kinds = refKind.split('+');
    for (const kind of kinds) {
      const names = resourceNames[kind] ?? [];
      for (const name of names) {
        items.push({
          label: name,
          kind: CompletionItemKind.Reference,
          detail: kind,
        });
      }
    }
  }

  // Const value
  if (schema.const !== undefined) {
    items.push({
      label: String(schema.const),
      kind: CompletionItemKind.Value,
      detail: 'Required value',
    });
  }

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

  if (schema.default !== undefined && !items.some(i => i.label === String(schema.default))) {
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
    // Match both regular keys and array item keys (- key:)
    const keyMatch = line.match(/^\s*(?:-\s+)?(\w[\w.-]*):/);

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
    } else if (current.type === 'array' && current.items?.properties) {
      // Walk into array items schema
      current = current.items;
      // Try to find the key in items properties
      if (current.properties && current.properties[key]) {
        current = current.properties[key];
      }
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

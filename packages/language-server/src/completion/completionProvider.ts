// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import {
  CompletionItem,
  CompletionItemKind,
  Position,
  InsertTextFormat,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseDocument, isMap, isScalar, isPair, YAMLMap, Scalar, Node } from 'yaml';
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
/** Cached resource schemas from the extension (ComponentType/Trait openAPIV3Schema). */
export type ResourceSchemaCache = Record<string, Record<string, { parameters?: unknown; environmentConfigs?: unknown }>>;

export function getCompletionItems(
  document: TextDocument,
  position: Position,
  schema: JsonSchema | null,
  resourceNames: Record<string, string[]> = {},
  crdKind?: string,
  resourceSchemas: ResourceSchemaCache = {},
): CompletionItem[] {
  const text = document.getText();
  const lines = text.split('\n');
  const currentLine = lines[position.line] ?? '';

  // CEL expression completions — detect if cursor is inside ${...}
  const celDetected = isInsideCelExpression(currentLine, position.character);
  if (celDetected) {
    return getCelCompletionItems(currentLine, position.character, crdKind ?? '', position.line, text);
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

  const yamlPath = resolveYamlPath(lines, position.line, indent);

  // Collect existing sibling keys at the cursor's indentation level
  const existingKeys = getExistingKeys(lines, position.line, indent);

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

  // Cross-document completions: Component spec.parameters, spec.traits[].parameters,
  // ReleaseBinding componentTypeEnvironmentConfigs, etc.
  if (crdKind && Object.keys(resourceSchemas).length > 0) {
    const crossDocItems = getCrossDocumentCompletions(
      text, yamlPath, crdKind, resourceSchemas, indent, existingKeys,
    );
    // Note: crossDocItems may be empty if path doesn't match or schema not found
    if (crossDocItems.length > 0) {
      return crossDocItems;
    }
  }

  // Key completion — if context is an array, offer properties from items schema
  const keySchema = (contextSchema.type === 'array' && contextSchema.items?.properties)
    ? contextSchema.items
    : contextSchema;
  return getPropertyCompletions(keySchema, indent, existingKeys);
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
  existingKeys: Set<string> = new Set(),
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

    // Skip properties already defined at this level
    if (existingKeys.has(key)) {
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
function resolveYamlPath(lines: string[], targetLine: number, cursorIndent?: number): string[] {
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

  // On empty/whitespace lines, the cursor indent determines the context level.
  // Pop path entries whose indent >= cursor indent (cursor is at same level or shallower).
  if (cursorIndent !== undefined) {
    while (indentStack.length > 0 && cursorIndent <= indentStack[indentStack.length - 1]) {
      indentStack.pop();
      path.pop();
    }
  }

  return path;
}

/**
 * Collect existing YAML keys at the same indentation level as the cursor.
 * Scans above and below the cursor line for sibling key definitions.
 */
function getExistingKeys(lines: string[], targetLine: number, targetIndent: number): Set<string> {
  const keys = new Set<string>();

  // Scan upward from cursor
  for (let i = targetLine - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || line.trim() === '' || line.trim().startsWith('#')) continue;
    const lineIndent = line.search(/\S/);
    if (lineIndent < targetIndent) break; // reached parent level
    if (lineIndent === targetIndent) {
      const keyMatch = line.match(/^\s*(?:-\s+)?(\w[\w.-]*):/);
      if (keyMatch) keys.add(keyMatch[1]);
    }
  }

  // Scan downward from cursor
  for (let i = targetLine + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim() === '' || line.trim().startsWith('#')) continue;
    const lineIndent = line.search(/\S/);
    if (lineIndent < targetIndent) break; // reached parent level
    if (lineIndent === targetIndent) {
      const keyMatch = line.match(/^\s*(?:-\s+)?(\w[\w.-]*):/);
      if (keyMatch) keys.add(keyMatch[1]);
    }
  }

  return keys;
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

/**
 * Cross-document completions: offer properties from referenced resource's openAPIV3Schema.
 * E.g., Component spec.parameters.* → from ComponentType's parameters schema.
 */
function getCrossDocumentCompletions(
  documentText: string,
  yamlPath: string[],
  crdKind: string,
  resourceSchemas: ResourceSchemaCache,
  indent: number,
  existingKeys: Set<string> = new Set(),
): CompletionItem[] {
  try {
    const doc = parseDocument(documentText, { keepSourceTokens: false });
    if (!doc.contents || !isMap(doc.contents)) return [];

    const pathStr = yamlPath.join('.');

    // Component: spec.parameters → lookup componentType → parameters schema
    if ((crdKind === 'Component') && pathStr === 'spec.parameters') {
      const ctName = extractFieldValue(doc.contents, ['spec', 'componentType', 'name']);
      if (ctName) {
        return getSchemaPropertyCompletions(ctName, 'parameters', resourceSchemas, indent, existingKeys);
      }
    }

    // ReleaseBinding: spec.componentTypeEnvironmentConfigs → need componentType from component
    // For now, offer all known environmentConfig properties from all ComponentTypes
    if (crdKind === 'ReleaseBinding' && pathStr === 'spec.componentTypeEnvironmentConfigs') {
      return getAllSchemaPropertyCompletions('environmentConfigs', resourceSchemas, indent, undefined, existingKeys);
    }

    // ReleaseBinding: spec.traitEnvironmentConfigs → offer trait instance names as keys
    // (would need component resolution — skip for now)

    // Component: spec.traits[].parameters → lookup trait name → parameters schema
    if (crdKind === 'Component' && yamlPath.length >= 3 &&
        yamlPath[0] === 'spec' && yamlPath[1] === 'traits' &&
        yamlPath[yamlPath.length - 1] === 'parameters') {
      // Try to find the trait name from the current array item context
      // This is complex — would need to track which array item we're in
      // For now, offer a merged set from all known traits
      return getAllSchemaPropertyCompletions('parameters', resourceSchemas, indent,
        ['Trait', 'ClusterTrait'], existingKeys);
    }
  } catch {
    // Non-fatal
  }
  return [];
}

/** Extract a scalar field value by walking a YAML path. */
function extractFieldValue(node: YAMLMap, fieldPath: string[]): string | undefined {
  let current: unknown = node;
  for (const key of fieldPath) {
    if (!isMap(current as Node)) return undefined;
    const map = current as YAMLMap;
    const pair = map.items.find(
      (item) => isPair(item) && isScalar(item.key) && String(item.key.value) === key,
    );
    if (!pair || !isPair(pair)) return undefined;
    current = pair.value;
  }
  if (isScalar(current as Node)) {
    return String((current as Scalar).value);
  }
  return undefined;
}

/** Get completions from a specific resource's schema. */
function getSchemaPropertyCompletions(
  resourceName: string,
  section: 'parameters' | 'environmentConfigs',
  resourceSchemas: ResourceSchemaCache,
  indent: number,
  existingKeys: Set<string> = new Set(),
): CompletionItem[] {
  for (const kindSchemas of Object.values(resourceSchemas)) {
    const schemaData = kindSchemas[resourceName];
    if (schemaData?.[section]) {
      return openAPIV3SchemaToCompletions(schemaData[section] as Record<string, unknown>, indent, existingKeys);
    }
  }
  return [];
}

/** Get merged completions from all resources' schemas (used when specific resource unknown). */
function getAllSchemaPropertyCompletions(
  section: 'parameters' | 'environmentConfigs',
  resourceSchemas: ResourceSchemaCache,
  indent: number,
  kindFilter?: string[],
  existingKeys: Set<string> = new Set(),
): CompletionItem[] {
  const seen = new Set<string>();
  const items: CompletionItem[] = [];

  for (const [kind, kindSchemas] of Object.entries(resourceSchemas)) {
    if (kindFilter && !kindFilter.includes(kind)) continue;
    for (const schemaData of Object.values(kindSchemas)) {
      if (schemaData[section]) {
        for (const item of openAPIV3SchemaToCompletions(schemaData[section] as Record<string, unknown>, indent, existingKeys)) {
          if (!seen.has(item.label)) {
            seen.add(item.label);
            items.push(item);
          }
        }
      }
    }
  }
  return items;
}

/** Convert an openAPIV3Schema to completion items for its properties. */
function openAPIV3SchemaToCompletions(
  schema: Record<string, unknown>,
  indent: number,
  existingKeys: Set<string> = new Set(),
): CompletionItem[] {
  const props = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!props) return [];

  const defs = (schema.$defs ?? schema.definitions ?? {}) as Record<string, Record<string, unknown>>;
  const items: CompletionItem[] = [];
  const indentStr = ' '.repeat(indent);

  for (const [name, propSchema] of Object.entries(props)) {
    if (existingKeys.has(name)) continue;
    // Resolve $ref
    let resolved = propSchema;
    const ref = propSchema.$ref as string | undefined;
    if (ref) {
      const match = ref.match(/^#\/\$defs\/(\w+)$/) ?? ref.match(/^#\/definitions\/(\w+)$/);
      if (match && defs[match[1]]) {
        resolved = defs[match[1]];
      }
    }

    const type = resolved.type as string | undefined;
    const defaultVal = resolved.default;
    const enumVals = resolved.enum as string[] | undefined;

    let detail = type ?? 'any';
    if (defaultVal !== undefined) detail += ` (default: ${defaultVal})`;

    const item: CompletionItem = {
      label: name,
      kind: CompletionItemKind.Property,
      detail,
      documentation: enumVals ? `Enum: ${enumVals.join(', ')}` : undefined,
      insertTextFormat: InsertTextFormat.Snippet,
    };

    if (type === 'object') {
      item.insertText = `${name}:\n${indentStr}  $0`;
    } else if (enumVals) {
      item.insertText = `${name}: \${1|${enumVals.join(',')}|}`;
    } else if (type === 'boolean') {
      item.insertText = `${name}: \${1|true,false|}`;
    } else if (defaultVal !== undefined) {
      item.insertText = `${name}: ${defaultVal}`;
    } else {
      item.insertText = `${name}: $0`;
    }

    items.push(item);
  }

  return items;
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

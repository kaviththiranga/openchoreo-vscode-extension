// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as fs from 'fs';
import * as path from 'path';
import type { CrdKind } from '../validation/crdDetector';

/**
 * Simplified JSON Schema type for CRD validation.
 */
export interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  const?: string | number | boolean;
  enum?: (string | number | boolean)[];
  default?: unknown;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  format?: string;
  $ref?: string;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
}

export type CrdSchemaMap = Partial<Record<CrdKind, JsonSchema>>;

/**
 * Load all CRD JSON Schemas from the schemas/ directory.
 * Schemas are named by CRD kind in lowercase: component.json, componenttype.json, etc.
 */
export function loadSchemas(): CrdSchemaMap {
  const schemasDir = path.resolve(__dirname, '..', '..', '..', '..', 'schemas');
  const schemas: CrdSchemaMap = {};

  if (!fs.existsSync(schemasDir)) {
    return schemas;
  }

  const files = fs.readdirSync(schemasDir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(schemasDir, file), 'utf-8');
      const schema = JSON.parse(content) as JsonSchema & {
        'x-openchoreo-kind'?: CrdKind;
      };

      // Schema files should have x-openchoreo-kind to identify the CRD kind
      const kind = schema['x-openchoreo-kind'];
      if (kind) {
        schemas[kind] = schema;
      }
    } catch {
      // Skip invalid schema files
    }
  }

  return schemas;
}

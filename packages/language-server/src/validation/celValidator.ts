// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import {
  Diagnostic,
  DiagnosticSeverity,
  Range,
} from 'vscode-languageserver/node';

/** Known top-level CEL context variables for ComponentType/Trait templates. */
const KNOWN_CEL_VARIABLES = new Set([
  'metadata',
  'parameters',
  'environmentConfigs',
  'workload',
  'configurations',
  'dependencies',
  'dataplane',
  'gateway',
  'environment',
  'trait',
  'resource',
  // CEL builtins and OC functions
  'has',
  'size',
  'type',
  'int',
  'string',
  'double',
  'bool',
  'bytes',
  'math',
  'base64',
  'oc_omit',
  'oc_merge',
  'oc_generate_name',
  'oc_dns_label',
  'oc_hash',
  // Literals and operators that might appear first
  'true',
  'false',
  'null',
]);

/**
 * Check if a string value contains CEL expressions (${...} patterns).
 */
export function containsCelExpression(value: string): boolean {
  return value.includes('${');
}

/**
 * Validate CEL expressions within a string value.
 * Checks for unbalanced braces, empty expressions, and unknown variables.
 */
export function validateCelExpressions(
  value: string,
  range: Range,
  diagnostics: Diagnostic[],
): void {
  let i = 0;
  while (i < value.length) {
    // Find next ${
    const start = value.indexOf('${', i);
    if (start === -1) break;

    // Find matching closing brace (brace-balanced)
    let depth = 1;
    let j = start + 2;
    let inString = false;
    let stringChar = '';

    while (j < value.length && depth > 0) {
      const ch = value[j];

      if (inString) {
        if (ch === stringChar && value[j - 1] !== '\\') {
          inString = false;
        }
      } else {
        if (ch === '"' || ch === "'") {
          inString = true;
          stringChar = ch;
        } else if (ch === '{') {
          depth++;
        } else if (ch === '}') {
          depth--;
        }
      }
      j++;
    }

    if (depth > 0) {
      // Unclosed CEL expression
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range,
        message: 'Unclosed CEL expression — missing closing }',
        source: 'openchoreo',
      });
      break;
    }

    // Extract expression content (between ${ and })
    const expr = value.substring(start + 2, j - 1).trim();

    if (expr.length === 0) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range,
        message: 'Empty CEL expression',
        source: 'openchoreo',
      });
    } else {
      // Check first identifier against known variables
      const firstIdMatch = expr.match(/^([a-zA-Z_]\w*)/);
      if (firstIdMatch) {
        const firstId = firstIdMatch[1];
        if (!KNOWN_CEL_VARIABLES.has(firstId)) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range,
            message: `Unknown CEL variable '${firstId}'. Known: metadata, parameters, workload, configurations, dependencies, etc.`,
            source: 'openchoreo',
          });
        }
      }
    }

    i = j;
  }
}

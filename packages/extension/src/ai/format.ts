// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/** A language-server diagnostic as it arrives over LSP (0-based positions). */
export interface WireDiagnostic {
  range: { start: { line: number; character: number } };
  severity?: number;
  message: string;
}

export interface ValidationResult {
  kind: string | null;
  diagnostics: WireDiagnostic[];
  /** Line where this document starts in a multi-document file. */
  lineOffset: number;
}

const SEVERITY = ['', 'error', 'warning', 'info', 'hint'];

/** Plain-text validation report for a chat agent. */
export function formatValidation(label: string, results: ValidationResult[]): string {
  const resources = results.filter((r) => r.kind);
  if (resources.length === 0) {
    return `${label} contains no OpenChoreo resource (apiVersion openchoreo.dev/v1alpha1 with a known kind), so there is nothing to validate.`;
  }
  const problems = resources.flatMap((r) =>
    r.diagnostics.map((d) => {
      const line = d.range.start.line + r.lineOffset + 1;
      const column = d.range.start.character + 1;
      return `- ${r.kind} line ${line}, column ${column} [${SEVERITY[d.severity ?? 1] || 'error'}]: ${d.message}`;
    }),
  );
  const kinds = resources.map((r) => r.kind).join(', ');
  if (problems.length === 0) return `${label} (${kinds}): no problems found.`;
  return `${label} (${kinds}): ${problems.length} problem${problems.length === 1 ? '' : 's'}.\n${problems.join('\n')}`;
}

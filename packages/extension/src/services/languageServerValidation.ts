// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'crypto';
import { parse } from 'yaml';
import { kindSpec } from '../kinds/registry';
import type { ValidationResult, WireDiagnostic } from '../ai/format';

export type TextValidation = Omit<ValidationResult, 'lineOffset'>;
const PREFIX = 'untitled:openchoreo-validation-';
interface Pending {
  resolve(diagnostics: WireDiagnostic[]): void;
  reject(error: Error): void;
}

/** Adapt the chat tool's validation to ordinary LSP document diagnostics. */
export class LanguageServerValidation {
  private pending = new Map<string, Pending>();

  constructor(
    private readonly send: (method: string, params: unknown) => Promise<void>,
    private readonly timeoutMs = 10000,
  ) {}

  accept(uri: string, diagnostics: WireDiagnostic[]): boolean {
    if (!uri.startsWith(PREFIX)) return false;
    this.pending.get(uri)?.resolve(diagnostics);
    return true; // Also suppress late/clear diagnostics for temporary documents.
  }

  async validate(text: string): Promise<TextValidation> {
    let kind: string | null = null;
    try {
      const doc = parse(text);
      if (doc?.apiVersion === 'openchoreo.dev/v1alpha1' && typeof doc.kind === 'string' && kindSpec(doc.kind)) kind = doc.kind;
    } catch { /* The language server reports YAML syntax errors. */ }
    if (!kind && !/apiVersion:\s*openchoreo\.dev\//.test(text)) return { kind: null, diagnostics: [] };
    const uri = `${PREFIX}${randomUUID()}.yaml`;
    let timer: ReturnType<typeof setTimeout>;
    const result = new Promise<WireDiagnostic[]>((resolve, reject) => {
      this.pending.set(uri, { resolve, reject });
      timer = setTimeout(() => reject(new Error('Language-server validation timed out. Restart the language server and retry.')), this.timeoutMs);
    });
    // Attach immediately: a disconnect can reject while didOpen is in flight.
    void result.catch(() => {});
    try {
      await this.send('textDocument/didOpen', { textDocument: { uri, languageId: 'yaml', version: 1, text } });
      return { kind, diagnostics: await result };
    } finally {
      clearTimeout(timer!);
      this.pending.delete(uri);
      await this.send('textDocument/didClose', { textDocument: { uri } }).catch(() => {});
    }
  }

  dispose(): void {
    for (const entry of this.pending.values()) entry.reject(new Error('Language server stopped during validation. Restart it and retry.'));
    this.pending.clear();
  }
}

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageServerValidation } from '../services/languageServerValidation';

const text = 'apiVersion: openchoreo.dev/v1alpha1\nkind: Component\nmetadata: {name: app}\nspec: {}';
const diagnostic = { message: 'Required field missing', severity: 1, range: { start: { line: 3, character: 0 } } };

describe('chat validation through standard LSP diagnostics', () => {
  afterEach(() => vi.useRealTimers());
  it('opens and closes a temporary document and returns its diagnostics', async () => {
    let validation: LanguageServerValidation;
    const send = vi.fn(async (method: string, params: unknown) => {
      if (method === 'textDocument/didOpen') {
        const { textDocument } = params as { textDocument: { uri: string; text: string; version: number } };
        expect(textDocument.text).toBe(text);
        expect(textDocument.version).toBe(1);
        validation.accept(textDocument.uri, [diagnostic]);
      }
    });
    validation = new LanguageServerValidation(send);
    await expect(validation.validate(text)).resolves.toEqual({ kind: 'Component', diagnostics: [diagnostic] });
    expect(send.mock.calls.map(c => c[0])).toEqual(['textDocument/didOpen', 'textDocument/didClose']);
    expect(validation.accept('file:///app.yaml', [])).toBe(false);
  });
  it('isolates concurrent requests and suppresses late diagnostics', async () => {
    const uris: string[] = [];
    const validation = new LanguageServerValidation(async (method, params) => {
      if (method === 'textDocument/didOpen') uris.push((params as {textDocument: {uri: string}}).textDocument.uri);
    });
    const first = validation.validate(text), second = validation.validate(text);
    expect(uris[0]).not.toBe(uris[1]);
    validation.accept(uris[1], []);
    validation.accept(uris[0], [diagnostic]);
    expect((await first).diagnostics).toEqual([diagnostic]);
    expect((await second).diagnostics).toEqual([]);
    expect(validation.accept(uris[0], [])).toBe(true);
  });
  it('ignores unrelated YAML without opening a server document', async () => {
    const send = vi.fn(async () => {});
    const validation = new LanguageServerValidation(send);
    await expect(validation.validate('kind: ConfigMap')).resolves.toEqual({kind: null, diagnostics: []});
    expect(send).not.toHaveBeenCalled();
  });
  it('times out with retry guidance and closes the temporary document', async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => {});
    const validation = new LanguageServerValidation(send, 25);
    const result = expect(validation.validate(text)).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(25);
    await result;
    expect(send.mock.calls).toHaveLength(2);
  });
  it('rejects pending validation on disconnect', async () => {
    const validation = new LanguageServerValidation(async () => {});
    const result = expect(validation.validate(text)).rejects.toThrow('stopped during validation');
    validation.dispose();
    await result;
  });
  it('cleans up after didOpen transport failure', async () => {
    const send = vi.fn(async (method: string) => { if (method === 'textDocument/didOpen') throw new Error('Disconnected'); });
    const validation = new LanguageServerValidation(send);
    await expect(validation.validate(text)).rejects.toThrow('Disconnected');
    expect(send).toHaveBeenLastCalledWith('textDocument/didClose', expect.anything());
  });
});

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { CELSuggestions, isCELMemberPrefix } from '../services/celSuggestions';

describe('CEL automatic suggestion guard', () => {
  it('recognizes unfinished CEL member access without matching ordinary YAML', () => {
    expect(isCELMemberPrefix('name: ${metadata.')).toBe(true);
    expect(isCELMemberPrefix("name: '${parameters.database.")).toBe(true);
    expect(isCELMemberPrefix('metadata.')).toBe(false);
    expect(isCELMemberPrefix('${metadata.name} ordinary.')).toBe(false);
  });
});

describe('CEL automatic suggestion controller', () => {
  let changed: (event: vscode.TextDocumentChangeEvent) => void;
  let activeChanged: () => void;
  let enabled: boolean;
  const prefix = 'apiVersion: openchoreo.dev/v1alpha1\nkind: ComponentType\nspec:\n  resources:\n    - template:\n        name: ';
  let document: vscode.TextDocument;
  let editor: vscode.TextEditor;
  let trigger: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers(); enabled = true;
    const text = prefix + '${metadata.';
    const positionAt = (offset: number) => {
      const before = text.slice(0, offset);
      return { line: before.split('\n').length - 1, character: before.slice(before.lastIndexOf('\n') + 1).length } as vscode.Position;
    };
    document = { uri: vscode.Uri.parse('file:///sample/type.yaml'), languageId: 'yaml', version: 1, getText: () => text, positionAt } as vscode.TextDocument;
    editor = { document, selection: { isEmpty: true, active: positionAt(text.length) } } as vscode.TextEditor;
    trigger = vi.fn(async () => undefined);
    Object.assign(vscode.workspace, {
      onDidChangeTextDocument: (callback: typeof changed) => { changed = callback; return { dispose() {} }; },
      getConfiguration: () => ({ get: () => enabled }),
    });
    Object.assign(vscode.window, {
      activeTextEditor: editor,
      onDidChangeActiveTextEditor: (callback: typeof activeChanged) => { activeChanged = callback; return { dispose() {} }; },
    });
    Object.assign(vscode.commands, { executeCommand: trigger });
  });
  afterEach(() => { vi.useRealTimers(); });
  function typeDot(paste = false) {
    const text = paste ? '${metadata.' : '.';
    changed({ document, contentChanges: [{ text, rangeOffset: document.getText().length - text.length }] } as unknown as vscode.TextDocumentChangeEvent);
  }
  it.each([false, true])('opens the standard dropdown after valid typed or pasted member access (%s)', async paste => {
    const hasMembers = vi.fn(async () => true);
    const controller = new CELSuggestions(hasMembers);
    typeDot(paste);
    await vi.advanceTimersByTimeAsync(100);
    expect(hasMembers).toHaveBeenCalledWith(document.uri.toString(), editor.selection.active);
    expect(trigger).toHaveBeenCalledWith('editor.action.triggerSuggest');
    controller.dispose();
  });
  it('respects disabled automatic triggers', async () => {
    enabled = false;
    const hasMembers = vi.fn(async () => true), controller = new CELSuggestions(hasMembers);
    typeDot(); await vi.advanceTimersByTimeAsync(200);
    expect(hasMembers).not.toHaveBeenCalled(); expect(trigger).not.toHaveBeenCalled(); controller.dispose();
  });
  it('does not open suggestions for an unsupported CEL context', async () => {
    const controller = new CELSuggestions(async () => false);
    typeDot(); await vi.advanceTimersByTimeAsync(200);
    expect(trigger).not.toHaveBeenCalled(); controller.dispose();
  });
  it('discards responses after edits and active-editor changes', async () => {
    let finish!: (value: boolean) => void;
    const controller = new CELSuggestions(() => new Promise(resolve => { finish = resolve; }));
    typeDot(); await vi.advanceTimersByTimeAsync(100);
    activeChanged(); finish(true); await Promise.resolve();
    expect(trigger).not.toHaveBeenCalled(); controller.dispose();
  });
  it('ignores a stopped language client', async () => {
    const controller = new CELSuggestions(async () => { throw new Error('stopped'); });
    typeDot(); await vi.advanceTimersByTimeAsync(200);
    expect(trigger).not.toHaveBeenCalled(); controller.dispose();
  });
  it('disposes a pending trigger', async () => {
    const hasMembers = vi.fn(async () => { throw new Error('stopped'); });
    const controller = new CELSuggestions(hasMembers);
    typeDot(); controller.dispose(); await vi.advanceTimersByTimeAsync(200);
    expect(hasMembers).not.toHaveBeenCalled(); expect(trigger).not.toHaveBeenCalled();
  });
});

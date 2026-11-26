// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { AutomaticSuggestions, isReferenceValuePrefix } from '../services/celSuggestions';

describe('reference value trigger guard', () => {
  it.each(['name:', '  name: ', '  - name: hea', '  name: "hea', "  name: 'hea", "  'name': hea"])('recognizes a scalar value prefix: %s', text => {
    expect(isReferenceValuePrefix(text)).toBe(true);
  });
  it.each(['# name: ', 'description: name: ', 'name: value # comment', 'name: "value"', 'name: ${metadata.', 'kind: ClusterTrait', 'name: ['])('ignores other contexts: %s', text => {
    expect(isReferenceValuePrefix(text)).toBe(false);
  });
});

describe('automatic resource-reference suggestions', () => {
  const header = 'apiVersion: openchoreo.dev/v1alpha1\nkind: ComponentType\nspec:\n  allowedTraits:\n    - kind: ClusterTrait\n      ';
  let text: string;
  let version: number;
  let changed: (event: vscode.TextDocumentChangeEvent) => void;
  let selectionChanged: () => void;
  let activeChanged: () => void;
  let document: vscode.TextDocument;
  let editor: vscode.TextEditor;
  let enabled: boolean;
  let trigger: ReturnType<typeof vi.fn>;
  const point = (content: string, offset: number) => {
    const before = content.slice(0, offset);
    return {line: before.split('\n').length - 1, character: before.slice(before.lastIndexOf('\n') + 1).length} as vscode.Position;
  };
  beforeEach(() => {
    vi.useFakeTimers(); enabled = true; text = header + 'name'; version = 1;
    document = {
      uri: vscode.Uri.parse('file:///workspace/type.yaml'), languageId: 'yaml',
      get version() { return version; }, getText: () => text, positionAt: (offset: number) => point(text, offset),
    } as vscode.TextDocument;
    editor = {document, selection: {isEmpty: true, active: point(text, text.length)}} as vscode.TextEditor;
    trigger = vi.fn(async () => undefined);
    Object.assign(vscode.workspace, {
      onDidChangeTextDocument: (cb: typeof changed) => { changed = cb; return {dispose() {}}; },
      getConfiguration: () => ({get: () => enabled}),
    });
    Object.assign(vscode.window, {
      activeTextEditor: editor,
      onDidChangeActiveTextEditor: (cb: typeof activeChanged) => { activeChanged = cb; return {dispose() {}}; },
      onDidChangeTextEditorSelection: (cb: (event: {textEditor: vscode.TextEditor}) => void) => { selectionChanged = () => cb({textEditor: editor}); return {dispose() {}}; },
    });
    Object.assign(vscode.commands, {executeCommand: trigger});
  });
  afterEach(() => vi.useRealTimers());
  function type(insert: string) {
    const offset = text.length;
    text += insert; version++;
    const caret = text.length - (insert.endsWith("''") || insert.endsWith('""') ? 1 : 0);
    editor.selection = {isEmpty: true, active: point(text, caret)} as vscode.Selection;
    changed({document, contentChanges: [{text: insert, rangeOffset: offset}]} as unknown as vscode.TextDocumentChangeEvent);
    selectionChanged();
  }
  it.each([':', ': ', ': ""', ": ''", ': hea'])('opens after typed or pasted values (%s), without inserting a resource', async insert => {
    const hasReferences = vi.fn(async () => true), cel = vi.fn(async () => false);
    const controller = new AutomaticSuggestions(cel, hasReferences);
    type(insert); const typed = text; await vi.advanceTimersByTimeAsync(100);
    expect(hasReferences).toHaveBeenCalledWith(document.uri.toString(), editor.selection.active);
    expect(cel).not.toHaveBeenCalled();
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith('editor.action.triggerSuggest');
    expect(text).toBe(typed); controller.dispose();
  });
  it('debounces colon/space typing and lets the widget filter later characters without more probes', async () => {
    const hasReferences = vi.fn(async () => true), controller = new AutomaticSuggestions(async () => false, hasReferences);
    type(':'); await vi.advanceTimersByTimeAsync(50); type(' ');
    await vi.advanceTimersByTimeAsync(100); type('hea'); await vi.advanceTimersByTimeAsync(200);
    expect(hasReferences).toHaveBeenCalledTimes(1); expect(trigger).toHaveBeenCalledTimes(1); controller.dispose();
  });
  it('ignores queued selection events from the previous keystroke while colon/space are typed', async () => {
    const hasReferences = vi.fn(async () => true), controller = new AutomaticSuggestions(async () => false, hasReferences);
    type(':');
    const offset = text.length; text += ' '; version++;
    changed({document, contentChanges: [{text: ' ', rangeOffset: offset}]} as unknown as vscode.TextDocumentChangeEvent);
    selectionChanged(); // the earlier colon caret is still reported
    editor.selection = {isEmpty: true, active: point(text, text.length)} as vscode.Selection;
    selectionChanged();
    await vi.advanceTimersByTimeAsync(100);
    expect(hasReferences).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith('editor.action.triggerSuggest'); controller.dispose();
  });
  it('does not open for metadata names, ordinary fields, empty indexes or missing kinds rejected by Go', async () => {
    const hasReferences = vi.fn(async () => false), controller = new AutomaticSuggestions(async () => false, hasReferences);
    type(': '); await vi.advanceTimersByTimeAsync(200);
    expect(hasReferences).toHaveBeenCalledTimes(1); expect(trigger).not.toHaveBeenCalled(); controller.dispose();
  });
  it('respects disabled automatic suggestions', async () => {
    enabled = false;
    const hasReferences = vi.fn(async () => true), controller = new AutomaticSuggestions(async () => false, hasReferences);
    type(': '); await vi.advanceTimersByTimeAsync(200);
    expect(hasReferences).not.toHaveBeenCalled(); expect(trigger).not.toHaveBeenCalled(); controller.dispose();
  });
  it('discards a response after cursor movement, even if the cursor returns', async () => {
    let finish!: (value: boolean) => void;
    const controller = new AutomaticSuggestions(async () => false, () => new Promise(resolve => { finish = resolve; }));
    type(': '); await vi.advanceTimersByTimeAsync(100);
    const original = editor.selection;
    editor.selection = {isEmpty: true, active: {line: 0, character: 0}} as vscode.Selection; selectionChanged();
    editor.selection = original; selectionChanged(); finish(true); await vi.advanceTimersByTimeAsync(1);
    expect(trigger).not.toHaveBeenCalled(); controller.dispose();
  });
  it('discards responses after document switches and disposal', async () => {
    let finish!: (value: boolean) => void;
    const controller = new AutomaticSuggestions(async () => false, () => new Promise(resolve => { finish = resolve; }));
    type(': '); await vi.advanceTimersByTimeAsync(100);
    activeChanged(); controller.dispose(); finish(true); await vi.advanceTimersByTimeAsync(1);
    expect(trigger).not.toHaveBeenCalled();
  });
  it('closes an old reference list and permits a fresh probe after feed/context changes', async () => {
    const hasReferences = vi.fn(async () => true), controller = new AutomaticSuggestions(async () => false, hasReferences);
    type(': '); await vi.advanceTimersByTimeAsync(100);
    controller.invalidate();
    expect(trigger).toHaveBeenCalledWith('hideSuggestWidget');
    type('hea'); await vi.advanceTimersByTimeAsync(100);
    expect(hasReferences).toHaveBeenCalledTimes(2); controller.dispose();
  });
  it('supports Explorer YAML without a second language client', async () => {
    Object.assign(document, {uri: vscode.Uri.parse('openchoreo://ctx/cluster-component-type/service.yaml')});
    const hasReferences = vi.fn(async () => true), controller = new AutomaticSuggestions(async () => false, hasReferences);
    type(': '); await vi.advanceTimersByTimeAsync(100);
    expect(hasReferences).toHaveBeenCalledWith(document.uri.toString(), editor.selection.active);
    expect(trigger).toHaveBeenCalledTimes(1); controller.dispose();
  });
});

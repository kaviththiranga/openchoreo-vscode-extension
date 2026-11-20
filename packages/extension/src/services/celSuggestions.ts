// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0
import * as vscode from 'vscode';

type HasCompletions = (uri: string, position: { line: number; character: number }) => Promise<boolean>;

/** A lightweight trigger guard; the Go CEL checker remains authoritative. */
export function isCELMemberPrefix(text: string): boolean {
  const start = text.lastIndexOf('${');
  if (start < 0) return false;
  const expression = text.slice(start + 2);
  return !expression.includes('}') && /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\.$/.test(expression);
}

/** Cheap trigger guard only; Go decides whether this is a reference mapping. */
export function isReferenceValuePrefix(text: string): boolean {
  const line = text.slice(text.lastIndexOf('\n') + 1);
  return !line.includes('${') && /^[ \t]*(?:-[ \t]+)?(?:name|'name'|"name")[ \t]*:[ \t]*['"]?[^\s'"#{}\[\],:$]*$/.test(line);
}

/** Open the ordinary suggest widget only for server-confirmed editing contexts. */
export class AutomaticSuggestions implements vscode.Disposable {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private disposed = false;
  private expected: {line: number; character: number} | undefined;
  private openedReference: string | undefined;
  private selectionReady = false;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly hasMembers: HasCompletions, private readonly hasReferences?: HasCompletions) {
    this.subscriptions = [
      vscode.workspace.onDidChangeTextDocument(event => this.changed(event)),
      vscode.window.onDidChangeActiveTextEditor(() => this.cancel(true)),
    ];
    // Selection movement invalidates responses even if the cursor later returns.
    // Ordinary typing moves the selection to the expected insertion position.
    if (vscode.window.onDidChangeTextEditorSelection) {
      this.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(event => {
        if (event.textEditor !== vscode.window.activeTextEditor || !this.expected) return;
        const selection = event.selections?.[0] ?? event.textEditor.selection;
        const active = selection.active;
        if (selection.isEmpty && active.line === this.expected.line && active.character === this.expected.character) {
          this.selectionReady = true;
        } else if (this.selectionReady) {
          this.cancel(true);
        }
        // Selection events from an earlier keystroke can arrive after the next
        // didChange. Observe the new insertion caret before treating a move as
        // invalidation; current() still verifies the actual caret at query/reply.
      }));
    }
  }

  private cancel(clearReference = false): void {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.expected = undefined;
    this.selectionReady = false;
    if (clearReference) this.openedReference = undefined;
  }

  private changed(event: vscode.TextDocumentChangeEvent): void {
    const editor = vscode.window.activeTextEditor;
    const document = event.document;
    if (this.disposed || !editor || editor.document !== document) return;
    this.cancel();
    if (!['file', 'openchoreo', 'untitled'].includes(document.uri.scheme) || document.languageId !== 'yaml') return;
    if (!vscode.workspace.getConfiguration('editor', document.uri).get<boolean>('suggestOnTriggerCharacters', true)) return;
    const change = event.contentChanges.length === 1 ? event.contentChanges[0] : undefined;
    if (!change) return;
    let offset = change.rangeOffset + change.text.length;
    // VS Code auto-pairs quotes but places the caret between them.
    if (change.text.endsWith("''") || change.text.endsWith('""')) offset--;
    const text = document.getText();
    if (!/\bapiVersion\s*:\s*['"]?openchoreo\.dev\//.test(text)) return;
    const before = text.slice(0, offset);
    const cel = change.text.endsWith('.') && isCELMemberPrefix(before);
    const reference = !cel && !!this.hasReferences && isReferenceValuePrefix(before);
    if (!cel && !reference) { this.openedReference = undefined; return; }
    const position = document.positionAt(offset);
    this.expected = position;
    const referenceKey = `${document.uri.toString()}:${position.line}:${before.slice(before.lastIndexOf('\n') + 1).split(':')[0]}`;
    // Once open, the Language Client/widget filters the complete candidate list;
    // do not issue another probe for each character typed in the same value.
    if (reference && this.openedReference === referenceKey) return;
    const version = document.version;
    const generation = this.generation;
    const current = () => !this.disposed && generation === this.generation && document.version === version
      && vscode.window.activeTextEditor === editor && editor.selection.isEmpty
      && editor.selection.active.line === position.line && editor.selection.active.character === position.character;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void (async () => {
        try {
          if (!current()) return;
          const found = await (cel ? this.hasMembers : this.hasReferences!)(document.uri.toString(), position);
          if (found && current()) {
            if (reference) this.openedReference = referenceKey;
            await vscode.commands.executeCommand('editor.action.triggerSuggest');
          }
        } catch { /* Startup, cancellation and invalid contexts leave normal editing intact. */ }
      })();
    }, 100);
  }

  invalidate(): void {
    if (this.disposed) return;
    const referenceWasOpen = this.openedReference !== undefined;
    this.cancel(true);
    if (referenceWasOpen) void vscode.commands.executeCommand('hideSuggestWidget').then(() => {}, () => {});
  }

  dispose(): void {
    this.disposed = true;
    this.cancel(true);
    for (const subscription of this.subscriptions) subscription.dispose();
  }
}

// Preserve the existing controller import for clients/tests using CEL alone.
export { AutomaticSuggestions as CELSuggestions };

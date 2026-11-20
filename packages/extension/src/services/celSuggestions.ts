// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0
import * as vscode from 'vscode';

type HasCELMembers = (uri: string, position: { line: number; character: number }) => Promise<boolean>;

/** A lightweight trigger guard; the Go CEL checker remains authoritative. */
export function isCELMemberPrefix(text: string): boolean {
  const start = text.lastIndexOf('${');
  if (start < 0) return false;
  const expression = text.slice(start + 2);
  return !expression.includes('}') && /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\.$/.test(expression);
}

/** Ensure unfinished/pasted CEL member access opens the ordinary suggest widget. */
export class CELSuggestions implements vscode.Disposable {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private disposed = false;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly hasMembers: HasCELMembers) {
    this.subscriptions = [
      vscode.workspace.onDidChangeTextDocument(event => this.changed(event)),
      vscode.window.onDidChangeActiveTextEditor(() => this.cancel()),
    ];
  }

  private cancel(): void {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private changed(event: vscode.TextDocumentChangeEvent): void {
    const editor = vscode.window.activeTextEditor;
    const document = event.document;
    if (this.disposed || !editor || editor.document !== document) return;
    this.cancel();
    if (!['file', 'openchoreo', 'untitled'].includes(document.uri.scheme) || document.languageId !== 'yaml') return;
    if (!vscode.workspace.getConfiguration('editor', document.uri).get<boolean>('suggestOnTriggerCharacters', true)) return;
    const change = event.contentChanges.length === 1 ? event.contentChanges[0] : undefined;
    if (!change?.text.endsWith('.')) return;
    const offset = change.rangeOffset + change.text.length;
    const text = document.getText();
    if (!/\bapiVersion\s*:\s*['"]?openchoreo\.dev\//.test(text) || !isCELMemberPrefix(text.slice(0, offset))) return;
    const position = document.positionAt(offset);
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
          // Requests travel through the existing Language Client after didChange.
          const found = await this.hasMembers(document.uri.toString(), position);
          if (found && current()) await vscode.commands.executeCommand('editor.action.triggerSuggest');
        } catch { /* Startup, cancellation and invalid contexts leave normal editing intact. */ }
      })();
    }, 100);
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
    for (const subscription of this.subscriptions) subscription.dispose();
  }
}

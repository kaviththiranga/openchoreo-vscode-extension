// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0
import * as vscode from 'vscode';
import { resourceReferenceRanges } from './resourceReferenceRanges';

type HasDefinition = (uri: string, position: {line: number; character: number}) => Promise<boolean>;

/** Underline only visible reference values resolved by the current Go server. */
export class DefinitionUnderlines implements vscode.Disposable {
  private readonly decoration = vscode.window.createTextEditorDecorationType({ textDecoration: 'underline' });
  private readonly subscriptions: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private disposed = false;

  constructor(private readonly hasDefinition: HasDefinition) {
    this.subscriptions.push(
      vscode.window.onDidChangeVisibleTextEditors(() => this.refresh()),
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
      vscode.window.onDidChangeTextEditorVisibleRanges(() => this.refresh()),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (vscode.window.visibleTextEditors.some(editor => editor.document === event.document)) this.refresh();
      }),
    );
    this.refresh();
  }

  refresh(): void {
    if (this.disposed) return;
    const generation = ++this.generation;
    if (this.timer) clearTimeout(this.timer);
    // Clear immediately; old ranges must not survive edits or context changes.
    for (const editor of vscode.window.visibleTextEditors) editor.setDecorations(this.decoration, []);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      for (const editor of vscode.window.visibleTextEditors) void this.update(editor, generation);
    }, 250);
  }

  private async update(editor: vscode.TextEditor, generation: number): Promise<void> {
    const document = editor.document;
    if (document.languageId !== 'yaml' || !['file', 'openchoreo', 'untitled'].includes(document.uri.scheme)) return;
    const version = document.version;
    const current = () => !this.disposed && this.generation === generation && editor.document === document && document.version === version;
    const visible = editor.visibleRanges.map(range => ({start: document.offsetAt(range.start), end: document.offsetAt(range.end)}));
    const candidates = resourceReferenceRanges(document.getText()).filter(ref => visible.some(range => ref.start <= range.end && ref.end >= range.start));
    const found: vscode.Range[] = [];
    let next = 0;
    await Promise.all(Array.from({length: Math.min(4, candidates.length)}, async () => {
      while (current() && next < candidates.length) {
        const ref = candidates[next++];
        try {
          const start = document.positionAt(ref.start);
          if (await this.hasDefinition(document.uri.toString(), start) && current()) found.push(new vscode.Range(start, document.positionAt(ref.end)));
        } catch { /* Startup/disconnection leaves this reference undecorated. */ }
      }
    }));
    if (current()) editor.setDecorations(this.decoration, found);
  }

  dispose(): void {
    this.disposed = true;
    ++this.generation;
    if (this.timer) clearTimeout(this.timer);
    for (const subscription of this.subscriptions) subscription.dispose();
    this.decoration.dispose();
  }
}

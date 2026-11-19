// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import * as vscode from 'vscode';

const enabled = process.env.OPENCHOREO_DEFINITIONS_TEST === '1';
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until<T>(work: () => Promise<T | undefined>, label: string): Promise<T> {
  const deadline = Date.now() + 30000;
  let error: unknown;
  while (Date.now() < deadline) {
    try { const value = await work(); if (value !== undefined) return value; } catch (err) { error = err; }
    await pause(250);
  }
  throw new Error(`Timed out: ${label}: ${String(error)}`);
}
function contextId(contextName = 'test'): string {
  return createHash('sha256').update(JSON.stringify([process.env.OPENCHOREO_DEFINITION_API, contextName])).digest('hex');
}
function remote(type: string, name: string, namespace = 'default', context = 'test'): vscode.Uri {
  return vscode.Uri.from({ scheme: 'openchoreo', authority: contextId(context), path: `/namespaces/${namespace}/${type}/${name}.yaml` });
}
async function locations(doc: vscode.TextDocument, text: string): Promise<vscode.Location[]> {
  const offset = doc.getText().indexOf(text);
  assert.ok(offset >= 0, `missing reference ${text}`);
  const result = await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>('vscode.executeDefinitionProvider', doc.uri, doc.positionAt(offset + 1));
  return (result ?? []).map(loc => 'targetUri' in loc ? new vscode.Location(loc.targetUri, loc.targetSelectionRange ?? loc.targetRange) : loc);
}
async function reveal(doc: vscode.TextDocument, text: string, expected: vscode.Uri): Promise<void> {
  const editor = await vscode.window.showTextDocument(doc);
  const position = doc.positionAt(doc.getText().indexOf(text) + 1);
  editor.selection = new vscode.Selection(position, position);
  await vscode.commands.executeCommand('editor.action.revealDefinition');
  await until(async () => vscode.window.activeTextEditor?.document.uri.toString() === expected.toString() ? true : undefined, 'F12 opens '+expected.toString());
}

(enabled ? describe : describe.skip)('occ Go to Definition in VS Code', function () {
  this.timeout(90000);
  before(async () => {
    const extension = vscode.extensions.getExtension('KavithLokuhewage.openchoreo-unofficial');
    assert.ok(extension);
    await extension.activate();
  });
  it('resolves an implicit local ComponentType and opens its file with F12', async () => {
    const root = vscode.workspace.workspaceFolders![0].uri;
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root, 'component.yaml'));
    const expected = vscode.Uri.joinPath(root, 'type # local.yaml');
    const result = await until(async () => { const result = await locations(doc, 'local-type'); return result.length ? result : undefined; }, 'local definition');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].uri.toString(), expected.toString());
    assert.ok(result[0].range.start.line >= 2);
    await reveal(doc, 'local-type', expected);
  });
  it('opens previously unopened cluster ComponentType and Trait definitions', async () => {
    const doc = await until(async () => vscode.workspace.openTextDocument(remote('component', 'remote-app')), 'Explorer resource');
    for (const [name, type] of [['remote-type', 'component-type'], ['logging', 'trait']]) {
      const expected = remote(type, name);
      assert.ok(!vscode.workspace.textDocuments.some(d => d.uri.toString() === expected.toString()), 'target must be unopened');
      const result = await until(async () => { const result = await locations(doc, name); return result.length ? result : undefined; }, name);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].uri.toString(), expected.toString());
      await reveal(doc, name, expected);
      assert.match(vscode.window.activeTextEditor!.document.getText(), new RegExp(`name: ${name}`));
    }
  });
  it('drops namespace/context snapshots and repopulates after restart', async () => {
    const filename = path.join(process.env.HOME!, '.openchoreo', 'config');
    const config = JSON.parse(fs.readFileSync(filename, 'utf8'));
    const old = await vscode.workspace.openTextDocument(remote('component', 'remote-app'));
    config.contexts[0].namespace = 'other';
    fs.writeFileSync(filename, JSON.stringify(config));
    const other = await until(async () => vscode.workspace.openTextDocument(remote('component', 'remote-app', 'other')), 'other namespace');
    await until(async () => (await locations(other, 'remote-type')).length ? true : undefined, 'new namespace snapshot');
    assert.strictEqual((await locations(old, 'remote-type')).length, 0);
    config.currentContext = 'second';
    fs.writeFileSync(filename, JSON.stringify(config));
    const second = await until(async () => vscode.workspace.openTextDocument(remote('component', 'remote-app', 'default', 'second')), 'second context');
    await until(async () => (await locations(second, 'remote-type')).length ? true : undefined, 'second context snapshot');
    assert.strictEqual((await locations(old, 'remote-type')).length, 0);
    await vscode.commands.executeCommand('openchoreo.restartLanguageServer');
    await until(async () => (await locations(second, 'logging')).length ? true : undefined, 'definitions after restart');
  });
});

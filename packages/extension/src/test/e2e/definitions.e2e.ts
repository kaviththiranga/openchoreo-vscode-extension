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
  it('keeps Problems findings and underlines when opening and closing result previews', async () => {
    const root = vscode.workspace.workspaceFolders![0].uri;
    const cases = [
      { active: vscode.Uri.joinPath(root, 'component.yaml'), target: vscode.Uri.joinPath(root, 'closed-component.yaml'), name: 'backend' },
      { active: remote('component', 'remote-app'), target: remote('component', 'closed-app'), name: 'closed-app' },
    ];
    const workloadError = (uri: vscode.Uri) => vscode.languages.getDiagnostics(uri).find(d => d.message.includes('no Workload for Component'));
    const findingKeys = () => vscode.languages.getDiagnostics().flatMap(([uri, diagnostics]) => diagnostics
      .filter(d => d.source === 'openchoreo-post-render')
      .map(d => `${uri.toString()}: ${d.message}`)).sort();
    for (const { active, target, name } of cases) {
      assert.ok(!vscode.workspace.textDocuments.some(doc => doc.uri.toString() === target.toString()), 'target must start unopened');
      const doc = await vscode.workspace.openTextDocument(active);
      await vscode.window.showTextDocument(doc, { preview: false });
      const result = await vscode.commands.executeCommand<{ files: number }>('openchoreo.validateRendering', active);
      assert.ok(result && result.files > 0, 'validation did not complete');
      await until(async () => workloadError(target), 'missing Workload in unopened resource');
      const expected = findingKeys();
      for (let attempt = 0; attempt < 2; attempt++) {
        const diagnostic = workloadError(target)!;
        // VS Code's Problems navigation opens this same URI and selection.
        await vscode.commands.executeCommand('vscode.open', target, { preview: true, selection: diagnostic.range });
        await until(async () => vscode.window.activeTextEditor?.document.uri.toString() === target.toString() ? true : undefined, 'Problems target opened');
        const editor = vscode.window.activeTextEditor!;
        const visible = await until(async () => workloadError(target), 'finding retained after open');
        assert.strictEqual(editor.document.getText(visible.range), name, 'error must underline Component metadata.name');
        const tab = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab => (tab.input as vscode.TabInputText)?.uri?.toString() === target.toString());
        assert.ok(tab);
        assert.ok(await vscode.window.tabGroups.close(tab));
        await until(async () => !vscode.workspace.textDocuments.some(doc => doc.uri.toString() === target.toString()) ? true : undefined, 'preview document closed');
        await pause(750); // Allow didClose and automatic diagnostic publications to finish.
        assert.ok(workloadError(target), 'closing a clean preview erased its finding');
        assert.deepStrictEqual(findingKeys(), expected, 'navigation cleared other validation findings');
      }
    }
  });
  it('reports wrong local and Explorer names and applies scoped quick fixes', async () => {
    const root = vscode.workspace.workspaceFolders![0].uri;
    for (const [uri, name] of [
      [vscode.Uri.joinPath(root, 'component.yaml'), 'local-type'],
      [remote('component', 'remote-app'), 'remote-type'],
    ] as const) {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
      const original = doc.getText();
      const offset = original.indexOf(name);
      assert.ok(offset >= 0);
      const range = new vscode.Range(doc.positionAt(offset), doc.positionAt(offset + name.length));
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, range, `${name}-typo`);
      assert.ok(await vscode.workspace.applyEdit(edit));
      try {
        const diagnostic = await until(async () => vscode.languages.getDiagnostics(uri)
          .find(d => d.code === 'unresolved-resource-reference' && d.message.includes(`${name}-typo`)), 'invalid reference error');
        assert.strictEqual(diagnostic.severity, vscode.DiagnosticSeverity.Error);
        assert.strictEqual(doc.getText(diagnostic.range), `${name}-typo`);
        const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
          'vscode.executeCodeActionProvider', uri, diagnostic.range, vscode.CodeActionKind.QuickFix.value);
        const action = actions?.find(a => a.title === `Change to ${name}`);
        assert.ok(action?.edit, `no scoped fix: ${actions?.map(a => a.title)}`);
        assert.ok(await vscode.workspace.applyEdit(action.edit));
        assert.strictEqual(doc.getText(), original);
        await until(async () => !vscode.languages.getDiagnostics(uri)
          .some(d => d.code === 'unresolved-resource-reference' && d.message.includes(`${name}-typo`)) ? true : undefined, 'reference error cleared');
      } finally {
        if (doc.getText() !== original) {
          const restore = new vscode.WorkspaceEdit();
          restore.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), original);
          await vscode.workspace.applyEdit(restore);
        }
      }
    }
  });
  it('runs the validation play command on unsaved local and Explorer YAML', async () => {
    const root = vscode.workspace.workspaceFolders![0].uri;
    for (const uri of [vscode.Uri.joinPath(root, 'component.yaml'), remote('component', 'remote-app')]) {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
      const original = doc.getText();
      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, doc.positionAt(original.length), '\nbogusValidationMarker: true\n');
      assert.ok(await vscode.workspace.applyEdit(edit));
      try {
        const result = await vscode.commands.executeCommand<{ files: number; errors: number; details?: string[] }>('openchoreo.validateRendering', uri);
        assert.ok(result && result.files > 0, 'play command did not finish');
        assert.ok(result.errors > 0, 'unsaved mistake was not validated');
        assert.ok(result.details?.some(line => line.includes('bogusValidationMarker')), 'validation ignored editor content');
        await until(async () => vscode.languages.getDiagnostics(uri).some(d => d.message.includes('bogusValidationMarker')) ? true : undefined, 'manual diagnostic in Problems');
      } finally {
        const restore = new vscode.WorkspaceEdit();
        restore.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), original);
        await vscode.workspace.applyEdit(restore);
      }
      await until(async () => !vscode.languages.getDiagnostics(uri).some(d => d.message.includes('bogusValidationMarker')) ? true : undefined, 'manual diagnostic cleared after edit');
    }
  });
  it('validates only the current OpenChoreo project in local and Explorer YAML', async () => {
    const root = vscode.workspace.workspaceFolders![0].uri;
    for (const uri of [vscode.Uri.joinPath(root, 'component.yaml'), remote('component', 'remote-app')]) {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
      const result = await vscode.commands.executeCommand<{ files: number; root: string; details?: string[] }>('openchoreo.validateRendering', uri);
      assert.ok(result && result.files > 0);
      assert.ok(result.root.includes('demo'), 'current project is absent from validation scope');
      assert.ok(!result.details?.some(line => line.includes('other-project-app')), 'unrelated project was validated');
      await pause(400);
      const unrelated = uri.scheme === 'file' ? vscode.Uri.joinPath(root, 'other-project.yaml') : remote('component', 'other-project-app');
      assert.ok(!vscode.languages.getDiagnostics(unrelated).some(d => d.source === 'openchoreo-post-render'), 'manual findings leaked into another project');
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

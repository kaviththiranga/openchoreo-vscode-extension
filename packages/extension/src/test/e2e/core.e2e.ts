// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * End-to-end checks in a real VS Code instance. They need no OpenChoreo
 * cluster: activation, command registration, and the language server
 * (validation, completion, hover) over the fixture workspace.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'KavithLokuhewage.openchoreo-unofficial';
const workspace = () => vscode.workspace.workspaceFolders![0].uri;
const fixture = (name: string) => vscode.Uri.joinPath(workspace(), name);

async function open(name: string): Promise<vscode.TextDocument> {
  const doc = await vscode.workspace.openTextDocument(fixture(name));
  await vscode.window.showTextDocument(doc);
  return doc;
}

/** Wait until the language server publishes diagnostics matching `done`. */
async function diagnosticsFor(
  uri: vscode.Uri,
  done: (d: vscode.Diagnostic[]) => boolean,
  timeoutMs = 30_000,
): Promise<vscode.Diagnostic[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const diags = vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'openchoreo');
    if (done(diags) || Date.now() > deadline) return diags;
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Completions can be empty until the server finishes initializing — retry briefly. */
async function completionLabels(uri: vscode.Uri, position: vscode.Position): Promise<string[]> {
  for (let i = 0; i < 40; i++) {
    const list = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider', uri, position,
    );
    const labels = list.items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
    if (labels.includes('type')) return labels;
    await new Promise((r) => setTimeout(r, 500));
  }
  return [];
}

describe('OpenChoreo extension (e2e)', () => {
  before(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `${EXTENSION_ID} is not installed in the test instance`);
    await ext.activate();
  });

  it('activates', () => {
    assert.strictEqual(vscode.extensions.getExtension(EXTENSION_ID)?.isActive, true);
  });

  it('registers every contributed command', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID)!;
    const contributed = (ext.packageJSON.contributes.commands as Array<{ command: string }>).map((c) => c.command);
    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = contributed.filter((c) => !registered.has(c));
    assert.deepStrictEqual(missing, []);
  });

  it('flags a misspelled field the API server would drop', async () => {
    const doc = await open('workload-typo.yaml');
    const diags = await diagnosticsFor(doc.uri, (d) => d.some((x) => x.message.includes('enviroment')));
    assert.ok(
      diags.some((d) => d.message === 'Unknown property "enviroment" in spec.container'),
      `got: ${JSON.stringify(diags.map((d) => d.message))}`,
    );
  });

  it('accepts an OpenChoreo 1.3 Project with a project type', async () => {
    const doc = await open('project.yaml');
    // Give the server time to validate, then expect nothing from it.
    await new Promise((r) => setTimeout(r, 3_000));
    const diags = vscode.languages.getDiagnostics(doc.uri).filter((d) => d.source === 'openchoreo');
    assert.deepStrictEqual(diags.map((d) => d.message), []);
  });

  it('validates 1.3 kinds such as ProjectType', async () => {
    const doc = await open('project-type.yaml');
    const diags = await diagnosticsFor(doc.uri, (d) => d.length > 0);
    assert.ok(
      diags.some((d) => d.message === 'Unknown property "bogus" in spec'),
      `got: ${JSON.stringify(diags.map((d) => d.message))}`,
    );
    assert.ok(!diags.some((d) => d.message.startsWith('Unknown CEL variable')));
  });

  it('completes Project spec fields from the generated schema', async () => {
    const doc = await open('project.yaml');
    const labels = await completionLabels(doc.uri, new vscode.Position(6, 2));
    assert.ok(labels.includes('type') && labels.includes('parameters'), `got: ${labels.join(',')}`);
  });

  it('shows hover documentation from the CRD', async () => {
    const doc = await open('project.yaml');
    const line = doc.getText().split('\n').findIndex((l) => l.includes('deploymentPipelineRef'));
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider', doc.uri, new vscode.Position(line, 4),
    );
    const text = hovers
      .flatMap((h) => h.contents)
      .map((c) => (typeof c === 'string' ? c : 'value' in c ? c.value : ''))
      .join('\n');
    assert.match(text, /deploymentPipelineRef|pipeline/i);
  });

  it('opens its fixtures from the workspace', () => {
    assert.strictEqual(path.basename(workspace().fsPath), 'e2e-workspace');
  });

  it('ships the chat skills, agents and instructions it contributes', () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID)!;
    const { chatSkills, chatAgents, chatInstructions } = extension.packageJSON.contributes;
    assert.ok(chatSkills.length > 0, 'no skills contributed');
    for (const entry of [...chatSkills, ...chatAgents, ...chatInstructions]) {
      const file = path.join(extension.extensionPath, entry.path);
      assert.ok(fs.existsSync(file), `${entry.path} is missing`);
    }
    for (const entry of chatSkills) {
      const name = /^name:\s*(\S+)/m.exec(fs.readFileSync(path.join(extension.extensionPath, entry.path), 'utf8'))?.[1];
      assert.strictEqual(name, path.basename(path.dirname(entry.path)), `${entry.path} name must match its folder`);
    }
  });

  describe('chat tools', () => {
    async function invoke(name: string, input: object): Promise<string> {
      const result = await vscode.lm.invokeTool(name, { input, toolInvocationToken: undefined });
      return result.content
        .map((part) => (part instanceof vscode.LanguageModelTextPart ? part.value : ''))
        .join('');
    }

    it('validates a file, including unsaved buffers, through the language server', async () => {
      const report = await invoke('openchoreo_validate_yaml', { filePath: fixture('workload-typo.yaml').fsPath });
      assert.match(report, /Workload line 12, column 5 \[\w+\]: .*enviroment/);
    });

    it('validates YAML text and multi-document streams', async () => {
      const project = fs.readFileSync(fixture('project.yaml').fsPath, 'utf8');
      const report = await invoke('openchoreo_validate_yaml', { content: `${project}\n---\n${project}` });
      assert.match(report, /\(Project, Project\): no problems found/);
    });

    it('describes the session and the active OpenChoreo resource', async () => {
      await open('project.yaml');
      const context = JSON.parse(await invoke('openchoreo_get_context', {}));
      assert.strictEqual(typeof context.connected, 'boolean');
      assert.deepStrictEqual(context.activeEditor.kind, 'Project');
      assert.deepStrictEqual(context.activeEditor.name, 'shop');
    });

    it('scaffolds a resource for the requested kind', async () => {
      const yaml = await invoke('openchoreo_scaffold_resource', { kind: 'Component', namespace: 'acme' });
      assert.match(yaml, /kind: Component/);
      assert.match(yaml, /namespace: "?acme"?/);
    });
  });
});

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { registerDefinitions } from '../gitops/definitions';
import type { GitOpsRepoIndex } from '../gitops/repoIndex';

vi.mock('vscode', async importOriginal => {
  const actual = await importOriginal<typeof import('vscode')>();
  return {
    ...actual,
    languages: { registerDefinitionProvider: vi.fn(() => ({ dispose() {} })) },
    Range: class { constructor(..._args: unknown[]) {} },
  };
});

function fixture(typeName = 'service', entries: Array<Record<string, unknown>> = []) {
  let enabled = true;
  const text = `apiVersion: openchoreo.dev/v1alpha1\nkind: Component\nmetadata: {name: app}\nspec:\n  componentType:\n    kind: ComponentType\n    name: ${typeName}\n`;
  const getText = vi.fn(() => text);
  const document = { getText, offsetAt: () => text.indexOf(typeName) + 1, positionAt: () => ({line: 0, character: 0}) } as unknown as vscode.TextDocument;
  const whenReady = vi.fn(async () => {});
  const find = vi.fn(() => entries);
  const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
  registerDefinitions(context, {repoIndex: {whenReady, find} as unknown as GitOpsRepoIndex, namespace: () => 'default', enabled: () => enabled});
  const provider = vi.mocked(vscode.languages.registerDefinitionProvider).mock.calls[0][1];
  const run = () => provider.provideDefinition!(document, {} as vscode.Position, {} as vscode.CancellationToken);
  return { run, getText, whenReady, find, disable: () => { enabled = false; } };
}

describe('GitOps definition fallback', () => {
  beforeEach(() => vi.clearAllMocks());
  it('does not add duplicate or unscoped targets while occ owns navigation', async () => {
    const f = fixture(); f.disable();
    expect(await f.run()).toBeUndefined();
    expect(f.getText).not.toHaveBeenCalled();
    expect(f.find).not.toHaveBeenCalled();
  });
  it('retains the upstream provider when occ is unavailable', async () => {
    const f = fixture();
    const locations = await f.run() as vscode.LocationLink[];
    expect(locations).toHaveLength(1);
    expect(locations[0].targetUri.path).toBe('/namespaces/default/component-type/service.yaml');
  });
  it('goes to the repository type only when its workload type matches', async () => {
    const entry = (workloadType: string) => ({ kind: 'ComponentType', name: 'service', uri: vscode.Uri.parse(`file:///repo/${workloadType}.yaml`), line: 0, workloadType });
    const match = await fixture('deployment/service', [entry('cronjob'), entry('deployment')]).run() as vscode.LocationLink[];
    expect(match.map((l) => l.targetUri.path)).toEqual(['/repo/deployment.yaml']);
    vi.clearAllMocks();
    const other = await fixture('deployment/service', [entry('cronjob')]).run() as vscode.LocationLink[];
    expect(other.map((l) => l.targetUri.path)).toEqual(['/namespaces/default/component-type/service.yaml']);
  });
  it('discards fallback results if occ starts while the repository index is loading', async () => {
    const f = fixture();
    let ready!: () => void;
    f.whenReady.mockImplementation(() => new Promise<void>(resolve => { ready = resolve; }));
    const result = f.run(); f.disable(); ready();
    expect(await result).toBeUndefined();
    expect(f.find).not.toHaveBeenCalled();
  });
});

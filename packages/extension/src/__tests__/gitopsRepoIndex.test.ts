// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { GitOpsRepoIndex } from '../gitops/repoIndex';

const state = vi.hoisted(() => ({
  files: new Map<string, string>(),
  watcher: {} as Record<string, (uri: import('vscode').Uri) => void>,
  findFiles: (async () => []) as () => Promise<import('vscode').Uri[]>,
}));
const { files, watcher } = state;

vi.mock('vscode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vscode')>();
  const folder = { uri: actual.Uri.parse('file:///repo'), name: 'repo', index: 0 };
  const on = (name: string) => (listener: (uri: vscode.Uri) => void) => { state.watcher[name] = listener; return { dispose() {} }; };
  return {
    ...actual,
    workspace: {
      workspaceFolders: [folder],
      createFileSystemWatcher: () => ({ onDidCreate: on('create'), onDidChange: on('change'), onDidDelete: on('delete'), dispose() {} }),
      onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
      findFiles: () => state.findFiles(),
      fs: {
        readFile: async (uri: vscode.Uri) => {
          const text = state.files.get(uri.path);
          if (text === undefined) throw new Error('ENOENT');
          return new TextEncoder().encode(text);
        },
      },
      asRelativePath: (uri: vscode.Uri) => uri.path.replace('/repo/', ''),
      getWorkspaceFolder: () => folder,
    },
    commands: { executeCommand: async () => undefined },
  };
});

const component = (name: string) => `apiVersion: openchoreo.dev/v1alpha1\nkind: Component\nmetadata:\n  name: ${name}\n  namespace: default\n`;
const add = (name: string) => {
  const path = `/repo/namespaces/default/components/${name}.yaml`;
  files.set(path, component(name));
  return vscode.Uri.parse(`file://${path}`);
};
const names = (index: GitOpsRepoIndex) => index.entries().map((e) => e.name).sort();

describe('GitOps repository index', () => {
  beforeEach(() => {
    files.clear();
    state.findFiles = async () => [...files.keys()].map((p) => vscode.Uri.parse(`file://${p}`));
  });
  afterEach(() => vi.useRealTimers());

  it('finds files on a rescan that the file watcher missed', async () => {
    const index = new GitOpsRepoIndex();
    add('api');
    await index.rebuild();
    add('worker'); // created before the watcher was live: no event
    expect(names(index)).toEqual(['api']);
    await index.rebuild();
    expect(names(index)).toEqual(['api', 'worker']);
  });

  it('keeps the current entries during a rescan and applies changes that arrive meanwhile', async () => {
    vi.useFakeTimers();
    const index = new GitOpsRepoIndex();
    add('api');
    await index.rebuild();
    let release!: () => void;
    const listed = [...files.keys()].map((p) => vscode.Uri.parse(`file://${p}`));
    state.findFiles = () => new Promise((resolve) => { release = () => resolve(listed); });
    const rescan = index.rebuild();
    watcher.create(add('late'));
    await vi.advanceTimersByTimeAsync(300);
    expect(names(index)).toEqual(['api']); // not emptied while scanning
    release();
    await rescan;
    await vi.advanceTimersByTimeAsync(0);
    expect(names(index)).toEqual(['api', 'late']);
  });
});

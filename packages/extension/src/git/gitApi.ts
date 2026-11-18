// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * The subset of the built-in Git extension's API (vscode.git, API version 1)
 * the extension uses. Typed here because the API ships no npm package.
 */
import * as vscode from 'vscode';

export interface GitRemote {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
}

export interface GitBranch {
  readonly name?: string;
  readonly commit?: string;
  readonly upstream?: { readonly remote: string; readonly name: string };
  readonly ahead?: number;
  readonly behind?: number;
}

export interface GitRepositoryState {
  readonly HEAD: GitBranch | undefined;
  readonly remotes: GitRemote[];
  readonly onDidChange: vscode.Event<void>;
}

export interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: GitRepositoryState;
  add(paths: string[]): Promise<void>;
  commit(message: string, opts?: { all?: boolean | 'tracked' }): Promise<void>;
  createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
  push(remoteName?: string, branchName?: string, setUpstream?: boolean): Promise<void>;
}

export interface GitAPI {
  readonly state: 'uninitialized' | 'initialized';
  readonly onDidChangeState: vscode.Event<'uninitialized' | 'initialized'>;
  readonly repositories: GitRepository[];
  readonly onDidOpenRepository: vscode.Event<GitRepository>;
  readonly onDidCloseRepository: vscode.Event<GitRepository>;
  getRepository(uri: vscode.Uri): GitRepository | null;
}

interface GitExtension {
  getAPI(version: 1): GitAPI;
}

/** The Git extension's API, or undefined when it is disabled or missing. */
export async function getGitApi(): Promise<GitAPI | undefined> {
  const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!ext) return undefined;
  try {
    if (!ext.isActive) await ext.activate();
    return ext.exports.getAPI(1);
  } catch {
    return undefined;
  }
}

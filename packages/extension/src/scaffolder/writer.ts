// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { getGitApi, type GitRepository } from '../git/gitApi';

/** The two scaffolded file paths, relative to the workspace folder. */
export const COMPONENT_REL_PATH = '.openchoreo/component.yaml';
export const WORKLOAD_REL_PATH = '.openchoreo/workload.yaml';

export interface ScaffoldFiles {
  componentYaml: string;
  workloadYaml: string;
}

export interface WriteResult {
  componentUri: vscode.Uri;
  workloadUri: vscode.Uri;
}

export interface ExistingFilesCheck {
  componentExists: boolean;
  workloadExists: boolean;
}

async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether the target files already exist — caller can warn the user
 * before overwriting.
 */
export async function checkExistingFiles(
  folder: vscode.WorkspaceFolder,
): Promise<ExistingFilesCheck> {
  const componentUri = vscode.Uri.joinPath(folder.uri, COMPONENT_REL_PATH);
  const workloadUri = vscode.Uri.joinPath(folder.uri, WORKLOAD_REL_PATH);
  const [componentExists, workloadExists] = await Promise.all([
    uriExists(componentUri),
    uriExists(workloadUri),
  ]);
  return { componentExists, workloadExists };
}

/** Write the scaffolded manifests to `.openchoreo/` in the workspace. */
export async function writeScaffoldFiles(
  folder: vscode.WorkspaceFolder,
  files: ScaffoldFiles,
): Promise<WriteResult> {
  const encoder = new TextEncoder();
  const componentUri = vscode.Uri.joinPath(folder.uri, COMPONENT_REL_PATH);
  const workloadUri = vscode.Uri.joinPath(folder.uri, WORKLOAD_REL_PATH);

  // vscode.workspace.fs.writeFile creates parent directories as needed.
  await Promise.all([
    vscode.workspace.fs.writeFile(componentUri, encoder.encode(files.componentYaml)),
    vscode.workspace.fs.writeFile(workloadUri, encoder.encode(files.workloadYaml)),
  ]);

  return { componentUri, workloadUri };
}

/** Stage `files` and commit them. The git API stages file paths, not URIs. */
export async function commitFiles(
  repo: Pick<GitRepository, 'add' | 'commit'>,
  files: vscode.Uri[],
  message: string,
): Promise<void> {
  await repo.add(files.map((uri) => uri.fsPath));
  await repo.commit(message);
}

/**
 * Stage the two files and create a commit.
 *
 * Returns `false` if git isn't available / folder isn't a repo — the caller
 * treats that as "skip silently, don't surface an error."
 */
export async function tryCommitScaffold(
  folder: vscode.WorkspaceFolder,
  files: WriteResult,
  message = 'chore: add OpenChoreo manifests',
): Promise<boolean> {
  try {
    const repo = (await getGitApi())?.getRepository(folder.uri);
    if (!repo) return false;
    await commitFiles(repo, [files.componentUri, files.workloadUri], message);
    return true;
  } catch {
    return false;
  }
}

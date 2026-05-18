// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';

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

// ---------- Minimal subset of vscode.git API (built-in extension) ----------

interface GitRepository {
  add(resources: vscode.Uri[]): Promise<void>;
  commit(message: string): Promise<void>;
  rootUri: vscode.Uri;
}

interface GitAPI {
  getRepository(uri: vscode.Uri): GitRepository | null;
}

interface GitExtension {
  getAPI(version: 1): GitAPI;
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
  const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!ext) return false;

  if (!ext.isActive) {
    try {
      await ext.activate();
    } catch {
      return false;
    }
  }

  try {
    const api = ext.exports.getAPI(1);
    const repo = api.getRepository(folder.uri);
    if (!repo) return false;
    await repo.add([files.componentUri, files.workloadUri]);
    await repo.commit(message);
    return true;
  } catch {
    return false;
  }
}

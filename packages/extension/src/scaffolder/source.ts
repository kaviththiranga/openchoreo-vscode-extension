// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as path from 'path';
import type * as vscode from 'vscode';
import { getGitApi } from '../git/gitApi';
import { normalizeAppPath, repositoryWebUrl } from '../workspace/repositoryFields';
import type { ComponentSourceLocation } from './renderers/component';

/** The folder's repository (origin first), branch and path within it, for the build workflow. */
export async function folderSource(folder: vscode.WorkspaceFolder): Promise<ComponentSourceLocation | undefined> {
  const repo = (await getGitApi())?.getRepository(folder.uri);
  if (!repo) return undefined;
  const remote = repo.state.remotes.find((r) => r.name === 'origin') ?? repo.state.remotes[0];
  const remoteUrl = remote?.fetchUrl ?? remote?.pushUrl;
  return {
    // Builders clone over https; scp-style remotes (git@host:org/repo) are rewritten.
    url: remoteUrl ? repositoryWebUrl(remoteUrl) ?? remoteUrl : undefined,
    branch: repo.state.HEAD?.name,
    appPath: normalizeAppPath(path.relative(repo.rootUri.fsPath, folder.uri.fsPath)),
  };
}

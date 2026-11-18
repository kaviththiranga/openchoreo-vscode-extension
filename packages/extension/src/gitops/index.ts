// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/** GitOps support: the repository index, Compare commands and the save guard. */
import * as vscode from 'vscode';
import type { ApiClientManager } from '../api/apiClient';
import type { OccConfigAuthProvider } from '../auth/authProvider';
import type { OpenChoreoFileSystemProvider } from '../filesystem/fileSystemProvider';
import type { ResourceNodeData } from '../treeView/types';
import { fetchLive, registerCompareCommands } from './compare';
import { confirmApiWrite, gitopsOwner } from './managed';
import { GitOpsRepoIndex } from './repoIndex';

export function registerGitOps(
  context: vscode.ExtensionContext,
  deps: {
    authProvider: OccConfigAuthProvider;
    apiClientManager: ApiClientManager;
    fsProvider: OpenChoreoFileSystemProvider;
    resolveNode: (arg: unknown) => ResourceNodeData | undefined;
    onModeChange: () => void;
  },
): GitOpsRepoIndex {
  const repoIndex = new GitOpsRepoIndex();
  context.subscriptions.push(repoIndex);
  void repoIndex.rebuild();

  registerCompareCommands(context, {
    apiClientManager: deps.apiClientManager,
    repoIndex,
    namespace: () => deps.authProvider.getContextInfo()?.namespace,
    resolveNode: deps.resolveNode,
  });

  deps.fsProvider.writeGuard = async (resource, isNew) => {
    const kind = String(resource.kind);
    const meta = (resource.metadata ?? {}) as { name?: string; namespace?: string };
    const name = meta.name ?? '';
    const decision = await confirmApiWrite(
      { kind, name, owner: gitopsOwner(meta as Parameters<typeof gitopsOwner>[0]), isNew },
      isNew ? 'Create' : 'Save',
      repoIndex.hasRepository,
    );
    if (decision === 'api') return undefined;
    const cancelled = 'Save cancelled; the cluster is unchanged.';
    if (decision === 'cancel') return cancelled;
    const before = isNew
      ? undefined
      : await fetchLive(deps.apiClientManager, { kind, name, namespace: meta.namespace }).catch(() => undefined);
    const file = await repoIndex.writeResource(resource, before);
    return file
      ? `Not saved to the cluster: the change is in ${vscode.workspace.asRelativePath(file)} in the GitOps repository, ready to commit.`
      : cancelled;
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('openchoreo.gitops')) deps.onModeChange();
    }),
  );
  return repoIndex;
}

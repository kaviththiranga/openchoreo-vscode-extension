// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/** Actions for the components linked to the open workspace (status bar item). */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ResourceNodeData } from '../treeView/types';
import type { BuildFollower } from './builds';
import type { ComponentLink, ComponentLinkService } from './componentLinks';
import type { SourcedComponent } from './componentSources';
import { repositoryWebUrl } from './repositoryFields';

/** A tree-node shaped argument so existing tree commands accept a linked component. */
export function componentNode(c: Pick<SourcedComponent, 'namespace' | 'project' | 'name'>): ResourceNodeData {
  return {
    label: c.name,
    type: 'component',
    contextValue: 'component',
    namespace: c.namespace,
    project: c.project,
    component: c.name,
    resourceName: c.name,
    childrenMode: 'none',
  };
}

interface Action extends vscode.QuickPickItem {
  run: () => unknown;
}

export function registerLinkedComponentCommands(
  context: vscode.ExtensionContext,
  links: ComponentLinkService,
  builds: BuildFollower,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('openchoreo.buildCommit', async () => {
      const link = await pickLink(links.orderedLinks());
      if (link) await builds.buildHead(link);
      else vscode.window.showInformationMessage('Open the source of an OpenChoreo component to build its current commit.');
    }),

    vscode.commands.registerCommand('openchoreo.linkedComponentActions', async () => {
      const link = await pickLink(links.orderedLinks());
      if (!link) return;
      const c = link.component;
      const node = componentNode(c);
      const workload = ['workload.yaml', 'workload.yml', '.openchoreo/workload.yaml', '.openchoreo/workload.yml']
        .map((f) => path.join(link.appDir, f))
        .find((f) => fs.existsSync(f));
      const web = c.url ? repositoryWebUrl(c.url) : undefined;
      const actions: Action[] = [
        { label: '$(file-code) Open Component YAML', run: () => vscode.commands.executeCommand('openchoreo.openResource', node) },
        ...(c.workflow && c.paths.commit
          ? [{ label: '$(play) Build This Commit', description: c.workflow.name, run: () => builds.buildHead(link) }]
          : c.workflow
            ? [{ label: '$(play) Build', description: c.workflow.name, run: () => vscode.commands.executeCommand('openchoreo.triggerBuild', node) }]
            : []),
        { label: '$(output) View Runtime Logs', run: () => vscode.commands.executeCommand('openchoreo.viewRuntimeLogs', node) },
        { label: '$(terminal) Open Shell', run: () => vscode.commands.executeCommand('openchoreo.openShell', node) },
        ...(workload
          ? [{
              label: '$(debug-alt) Run Locally Against Environment',
              description: vscode.workspace.asRelativePath(workload),
              run: () => vscode.commands.executeCommand('openchoreo.runLocally', vscode.Uri.file(workload)),
            }]
          : []),
        ...(web ? [{ label: '$(github) Open Repository', description: web, run: () => vscode.env.openExternal(vscode.Uri.parse(web)) }] : []),
        { label: '$(folder-opened) Reveal App Folder', description: link.appDir, run: () => vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(link.appDir)) },
        { label: '$(refresh) Refresh Links', run: () => links.refresh() },
      ];
      const picked = await vscode.window.showQuickPick(actions, {
        title: `${c.name} · project ${c.project}`,
        placeHolder: c.url ? `${c.url}${c.branch ? ` @ ${c.branch}` : ''}` : 'Component',
      });
      await picked?.run();
    }),
  );
}

async function pickLink(links: ComponentLink[]): Promise<ComponentLink | undefined> {
  const unique = [...new Map(links.map((l) => [`${l.component.namespace}/${l.component.name}`, l])).values()];
  if (unique.length <= 1) return unique[0];
  const picked = await vscode.window.showQuickPick(
    unique.map((l) => ({
      label: l.component.name,
      description: `project ${l.component.project}`,
      detail: l.component.appPath ? l.component.appPath : 'repository root',
      link: l,
    })),
    { placeHolder: 'Linked component' },
  );
  return picked?.link;
}

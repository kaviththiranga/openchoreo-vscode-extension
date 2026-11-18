// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Clone Source: clone a component's repository at the branch it builds from
 * and open it with the app folder revealed.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ResourceNodeData } from '../treeView/types';
import type { ComponentLinkService } from './componentLinks';
import type { ComponentSourceService } from './componentSources';

const PENDING_KEY = 'openchoreo.pendingReveal';

interface PendingReveal {
  folder: string;
  appPath: string;
  component: string;
}

/** The directory name `git clone` would pick for a URL. */
export function cloneDirName(url: string): string {
  const last = url.trim().replace(/[/\\]+$/, '').split(/[/:\\]/).pop() ?? '';
  return last.replace(/\.git$/i, '') || 'repository';
}

export function registerCloneSource(
  context: vscode.ExtensionContext,
  deps: {
    sources: ComponentSourceService;
    links: ComponentLinkService;
    resolveNode: (arg: unknown) => ResourceNodeData | undefined;
  },
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('openchoreo.cloneSource', async (arg: unknown) => {
      const node = deps.resolveNode(arg);
      if (!node?.namespace || !node.component) return;
      try {
        const component = await deps.sources.get(node.namespace, node.component);
        if (!component?.url) {
          vscode.window.showWarningMessage(
            component?.workflow
              ? `The ${component.workflow.name} workflow doesn't mark a repository URL parameter, so ${node.component}'s source can't be found.`
              : `${node.component} has no build workflow, so it has no source repository to clone.`,
          );
          return;
        }
        const open = deps.links.links.find((l) => l.component.name === component.name && l.component.namespace === component.namespace);
        if (open) {
          await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(open.appDir));
          vscode.window.showInformationMessage(`${component.name}'s source is already open in this window.`);
          return;
        }

        const defaultParent =
          vscode.workspace.getConfiguration('git').get<string>('defaultCloneDirectory') || os.homedir();
        const [parent] =
          (await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            defaultUri: vscode.Uri.file(defaultParent.replace(/^~(?=$|[\\/])/, os.homedir())),
            openLabel: 'Clone Here',
            title: `Clone ${component.url}${component.branch ? ` (${component.branch})` : ''}`,
          })) ?? [];
        if (!parent) return;

        const target = path.join(parent.fsPath, cloneDirName(component.url));
        if (fs.existsSync(target)) {
          const OPEN = 'Open It';
          const choice = await vscode.window.showWarningMessage(`${target} already exists.`, OPEN);
          if (choice === OPEN) await openClone(context, target, component.appPath ?? '', component.name);
          return;
        }

        const cloned = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Cloning ${component.url}${component.branch ? ` at ${component.branch}` : ''}`,
            cancellable: true,
          },
          (_progress, token) => gitClone(component.url!, target, component.branch, token),
        );
        if (cloned === 'cancelled') return;
        if (cloned !== 'ok') {
          // Credentials: VS Code's own clone asks for them.
          const RETRY = 'Clone with VS Code';
          const choice = await vscode.window.showErrorMessage(`Clone failed: ${cloned}`, RETRY);
          if (choice === RETRY) await vscode.commands.executeCommand('git.clone', component.url, parent.fsPath);
          return;
        }
        await openClone(context, target, component.appPath ?? '', component.name);
      } catch (err) {
        vscode.window.showErrorMessage(`Clone Source failed: ${err instanceof Error ? err.message : err}`);
      }
    }),
  );

  void revealPending(context);
}

function gitClone(url: string, target: string, branch: string | undefined, token: vscode.CancellationToken): Promise<string> {
  return new Promise((resolve) => {
    const args = ['clone', ...(branch ? ['--branch', branch] : []), '--', url, target];
    const child = spawn('git', args, { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += String(d)));
    token.onCancellationRequested(() => {
      child.kill();
      fs.rmSync(target, { recursive: true, force: true });
      resolve('cancelled');
    });
    child.on('error', (err) => resolve(err.message));
    child.on('close', (code) => {
      if (code === 0) resolve('ok');
      else resolve(stderr.trim().split('\n').filter((l) => !/^Cloning into/.test(l)).pop() ?? `git exited with ${code}`);
    });
  });
}

async function openClone(context: vscode.ExtensionContext, folder: string, appPath: string, component: string): Promise<void> {
  const OPEN = 'Open';
  const NEW = 'Open in New Window';
  const ADD = 'Add to Workspace';
  const choice = await vscode.window.showInformationMessage(
    `Cloned ${component}'s source to ${folder}.`,
    OPEN,
    NEW,
    ...(vscode.workspace.workspaceFolders?.length ? [ADD] : []),
  );
  if (!choice) return;
  const uri = vscode.Uri.file(folder);
  const pending: PendingReveal = { folder, appPath, component };
  await context.globalState.update(PENDING_KEY, pending);
  if (choice === ADD) {
    vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0, { uri });
    setTimeout(() => void revealPending(context), 1500);
  } else {
    await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: choice === NEW });
  }
}

/** After opening a fresh clone, reveal the component's app folder once. */
async function revealPending(context: vscode.ExtensionContext): Promise<void> {
  const pending = context.globalState.get<PendingReveal>(PENDING_KEY);
  if (!pending) return;
  const folder = vscode.workspace.workspaceFolders?.find((f) => f.uri.fsPath === pending.folder);
  if (!folder) return;
  await context.globalState.update(PENDING_KEY, undefined);
  const appDir = vscode.Uri.joinPath(folder.uri, ...pending.appPath.split('/').filter(Boolean));
  await vscode.commands.executeCommand('revealInExplorer', appDir);
  for (const name of ['workload.yaml', '.openchoreo/workload.yaml', 'README.md']) {
    const file = vscode.Uri.joinPath(appDir, name);
    if (fs.existsSync(file.fsPath)) {
      await vscode.window.showTextDocument(file, { preview: true });
      break;
    }
  }
}

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * The developer's outer loop from the editor: build the commit you're on,
 * and after a push, find the build auto-build started for it and follow it
 * in the status bar through to success or failure.
 */
import * as vscode from 'vscode';
import type { ApiClientManager } from '../api/apiClient';
import { newRunName, type WorkflowRunService } from '../services/workflowRunService';
import { log } from '../logging/logger';
import type { ResourceNodeData } from '../treeView/types';
import type { ComponentLink, ComponentLinkService, PushEvent } from './componentLinks';
import type { SourcedComponent } from './componentSources';
import { readPath, writePath } from './repositoryFields';
import type { GitRepository } from '../git/gitApi';

const POLL_MS = 5_000;
const FIND_TIMEOUT_MS = 3 * 60_000;
const FOLLOW_TIMEOUT_MS = 60 * 60_000;

interface RunItem {
  metadata?: { name?: string; creationTimestamp?: string };
  spec?: { workflow?: { parameters?: Record<string, unknown> } };
  status?: { phase?: string };
}

export type RunOutcome = 'succeeded' | 'failed' | 'running';

export function runOutcome(phase: string | undefined): RunOutcome {
  if (!phase) return 'running';
  if (/^(succeeded|completed|success)$/i.test(phase)) return 'succeeded';
  if (/^(failed|error|cancelled|canceled|aborted)$/i.test(phase)) return 'failed';
  return 'running';
}

/** The run built from `commit`: its commit parameter matches, else the first run created after `since`. */
export function findRunForCommit(
  runs: RunItem[],
  component: Pick<SourcedComponent, 'paths'>,
  commit: string,
  since: number,
): RunItem | undefined {
  const commitPath = component.paths.commit;
  const matches = (run: RunItem) => {
    if (commitPath) {
      const value = readPath(run.spec?.workflow?.parameters, commitPath);
      if (typeof value === 'string' && value && (commit.startsWith(value) || value.startsWith(commit))) return true;
    }
    return false;
  };
  const byCommit = runs.find(matches);
  if (byCommit) return byCommit;
  // Auto-build may record the commit elsewhere; fall back to a run that started after the push.
  return runs
    .filter((r) => Date.parse(r.metadata?.creationTimestamp ?? '') >= since - 10_000)
    .sort((a, b) => Date.parse(a.metadata?.creationTimestamp ?? '') - Date.parse(b.metadata?.creationTimestamp ?? ''))[0];
}

/** Workflow parameters that build `commit` (and `branch`, when the workflow takes one). */
export function parametersForCommit(
  component: Pick<SourcedComponent, 'paths' | 'parameters'>,
  commit: string,
  branch?: string,
): Record<string, unknown> {
  const parameters = structuredClone(component.parameters ?? {});
  if (!component.paths.commit) throw new Error("This component's workflow doesn't take a commit parameter.");
  writePath(parameters, component.paths.commit, commit);
  if (branch && component.paths.branch) writePath(parameters, component.paths.branch, branch);
  return parameters;
}

export class BuildFollower implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly following = new Map<string, BuildStatus>();
  private disposed = false;

  constructor(
    private readonly links: ComponentLinkService,
    private readonly apiClientManager: ApiClientManager,
    private readonly runs: WorkflowRunService,
  ) {
    this.disposables.push(links.onDidPush((e) => void this.onPush(e)));
  }

  /** Build the HEAD commit of a linked component's repository. */
  async buildHead(link: ComponentLink): Promise<void> {
    const repo = this.links.repositoryFor(link);
    const head = repo?.state.HEAD;
    if (!repo || !head?.commit) {
      vscode.window.showWarningMessage(`No git commit found in ${link.repoRoot.fsPath}.`);
      return;
    }
    const component = link.component;
    if (!component.workflow) {
      vscode.window.showWarningMessage(`${component.name} has no build workflow.`);
      return;
    }
    if (!component.paths.commit) {
      vscode.window.showWarningMessage(
        `The ${component.workflow.name} workflow doesn't mark a commit parameter, so a specific commit can't be built. Use Trigger Build instead.`,
      );
      return;
    }
    if ((head.ahead ?? 0) > 0 || !head.upstream) {
      const PUSH = 'Push and Build';
      const choice = await vscode.window.showWarningMessage(
        `${short(head.commit)} isn't on the remote yet, so the build can't fetch it.`,
        PUSH,
        'Build Anyway',
      );
      if (!choice) return;
      if (choice === PUSH) {
        if (!(await push(repo))) return;
        // The push starts auto-build, which the push listener follows.
        if (component.autoBuild) return;
      }
    }
    if (component.branch && head.name && head.name !== component.branch) {
      const go = await vscode.window.showInformationMessage(
        `${component.name} builds from ${component.branch}; you're on ${head.name}. Build ${short(head.commit)} from ${head.name}?`,
        'Build',
      );
      if (go !== 'Build') return;
    }
    await this.createRun(component, head.commit, head.name);
  }

  private async createRun(component: SourcedComponent, commit: string, branch?: string): Promise<void> {
    try {
      const runName = newRunName(component.name);
      await this.runs.createWorkflowRun(component.namespace, {
        metadata: {
          name: runName,
          namespace: component.namespace,
          labels: { 'openchoreo.dev/project': component.project, 'openchoreo.dev/component': component.name },
        },
        spec: {
          workflow: {
            kind: component.workflow!.kind,
            name: component.workflow!.name,
            parameters: parametersForCommit(component, commit, branch),
          },
        },
      });
      void this.followRun(component, runName, commit);
    } catch (err) {
      vscode.window.showErrorMessage(`Build failed to start: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async onPush(event: PushEvent): Promise<void> {
    if (!vscode.workspace.getConfiguration('openchoreo.builds').get<boolean>('followAfterPush', true)) return;
    const since = Date.now();
    const affected = this.links.links.filter(
      (l) => l.repoRoot.toString() === event.repository.rootUri.toString() && (!l.component.branch || l.component.branch === event.branch),
    );
    const seen = new Set<string>();
    for (const link of affected) {
      const key = `${link.component.namespace}/${link.component.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (link.component.autoBuild) {
        void this.findAndFollow(link.component, event.commit, since);
      } else if (link.component.workflow && link.component.paths.commit) {
        const BUILD = `Build ${link.component.name}`;
        void vscode.window
          .showInformationMessage(`Pushed ${short(event.commit)} to ${event.branch}.`, BUILD)
          .then((choice) => {
            if (choice === BUILD) void this.createRun(link.component, event.commit, event.branch);
          });
      }
    }
  }

  /** One status bar item per component; a newer follow of the same component replaces it. */
  private status(component: SourcedComponent): BuildStatus {
    const key = `${component.namespace}/${component.name}`;
    this.following.get(key)?.dispose();
    const status = new BuildStatus(() => this.following.get(key) === status && this.following.delete(key));
    this.following.set(key, status);
    return status;
  }

  private async findAndFollow(component: SourcedComponent, commit: string, since: number): Promise<void> {
    const status = this.status(component);
    status.show(`$(sync~spin) ${component.name}: waiting for the build of ${short(commit)}`);
    const deadline = Date.now() + FIND_TIMEOUT_MS;
    while (Date.now() < deadline && status.active && !this.disposed) {
      try {
        const run = findRunForCommit(await this.listRuns(component), component, commit, since);
        const name = run?.metadata?.name;
        if (name) return this.followRun(component, name, commit, status);
      } catch (err) {
        log.error('Looking for the build after a push failed', err);
      }
      await delay(POLL_MS);
    }
    status.dispose();
  }

  private async followRun(component: SourcedComponent, runName: string, commit: string, status = this.status(component)): Promise<void> {
    const node = runNode(component, runName);
    const deadline = Date.now() + FOLLOW_TIMEOUT_MS;
    status.show(`$(sync~spin) ${component.name}: building ${short(commit)}`, node);
    while (Date.now() < deadline && status.active && !this.disposed) {
      let phase: string | undefined;
      try {
        phase = (await this.runs.getStatus(component.namespace, runName))?.status;
      } catch (err) {
        log.error(`Reading build ${runName} failed`, err);
      }
      const outcome = runOutcome(phase);
      if (outcome === 'succeeded') {
        status.finish(`$(check) ${component.name}: built ${short(commit)}`, node);
        const LOGS = 'View Logs';
        const choice = await vscode.window.showInformationMessage(`${component.name} built from ${short(commit)}.`, LOGS);
        if (choice === LOGS) void vscode.commands.executeCommand('openchoreo.viewWorkflowRunLogs', node);
        return;
      }
      if (outcome === 'failed') {
        status.finish(`$(error) ${component.name}: build of ${short(commit)} ${phase?.toLowerCase()}`, node);
        const LOGS = 'View Logs';
        const ASK = 'Troubleshoot with Copilot';
        const choice = await vscode.window.showErrorMessage(
          `The build of ${component.name} from ${short(commit)} ${phase?.toLowerCase()}.`,
          LOGS,
          ASK,
        );
        if (choice === LOGS) void vscode.commands.executeCommand('openchoreo.viewWorkflowRunLogs', node);
        if (choice === ASK) void vscode.commands.executeCommand('openchoreo.troubleshootWithCopilot', { ...node, statusPhase: phase });
        return;
      }
      if (phase) status.show(`$(sync~spin) ${component.name}: building ${short(commit)} (${phase})`, node);
      await delay(POLL_MS);
    }
    status.dispose();
  }

  private async listRuns(component: SourcedComponent): Promise<RunItem[]> {
    const client = await this.apiClientManager.getClient();
    if (!client) return [];
    const { data } = await client.GET('/api/v1/namespaces/{namespaceName}/workflowruns', {
      params: {
        path: { namespaceName: component.namespace },
        query: { labelSelector: `openchoreo.dev/project=${component.project},openchoreo.dev/component=${component.name}` },
      },
    });
    return (data?.items ?? []) as RunItem[];
  }

  dispose(): void {
    this.disposed = true;
    this.following.forEach((status) => status.dispose());
    this.disposables.forEach((d) => d.dispose());
  }
}

class BuildStatus implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  active = true;

  constructor(private readonly onDispose: () => void) {
    this.item.name = 'OpenChoreo Build';
  }

  show(text: string, node?: ResourceNodeData): void {
    this.item.text = text;
    this.item.tooltip = node ? `Workflow run ${node.resourceName}. Click for logs.` : 'Waiting for auto-build to start';
    this.item.command = node ? { title: 'View Logs', command: 'openchoreo.viewWorkflowRunLogs', arguments: [node] } : undefined;
    this.item.show();
  }

  /** Show the result for a minute, then go away. */
  finish(text: string, node: ResourceNodeData): void {
    this.show(text, node);
    this.active = false;
    setTimeout(() => this.dispose(), 60_000);
  }

  dispose(): void {
    this.active = false;
    this.item.dispose();
    this.onDispose();
  }
}

function runNode(component: SourcedComponent, runName: string): ResourceNodeData {
  return {
    label: runName,
    type: 'workflow-run',
    contextValue: 'workflow-run',
    namespace: component.namespace,
    project: component.project,
    component: component.name,
    resourceName: runName,
    childrenMode: 'none',
  };
}

async function push(repo: GitRepository): Promise<boolean> {
  try {
    const head = repo.state.HEAD;
    if (head?.upstream) await repo.push();
    else await repo.push('origin', head?.name, true);
    return true;
  } catch (err) {
    vscode.window.showErrorMessage(`Push failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

const short = (commit: string) => commit.slice(0, 7);
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

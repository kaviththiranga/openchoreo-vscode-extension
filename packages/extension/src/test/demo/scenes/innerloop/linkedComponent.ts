// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from 'child_process';
import * as path from 'path';
import type { Locator, Page } from 'playwright-core';
import { api, occContext } from '../../cluster';
import type { Demo, Scene } from '../../demo';
import { parkMouse, pick, quickInput, quickItem, statusItem, statusText, tidy, widenSidebar, workspaceFolder } from './helpers';

/** The source-built component the sample-workloads clone links to, and its app folder. */
export const LINKED = { component: 'greeting-service', appFolder: 'service-go-greeter' };

/** Names of the component's workflow runs. */
async function runNames(): Promise<Set<string>> {
  const { namespace } = occContext();
  const selector = encodeURIComponent(`openchoreo.dev/component=${LINKED.component}`);
  const { json } = await api('GET', `/api/v1/namespaces/${namespace}/workflowruns?labelSelector=${selector}&limit=200`);
  const items = (json as { items?: { metadata?: { name?: string } }[] } | undefined)?.items ?? [];
  return new Set(items.map((i) => i.metadata?.name ?? '').filter(Boolean));
}

/**
 * The build a scene starts is only shown starting; delete it after the take
 * (teardown) so repeated takes don't queue builds on the cluster. Only runs
 * the scene created.
 */
async function deleteRunsSince(before: Set<string>): Promise<void> {
  const { namespace } = occContext();
  for (const name of await runNames()) {
    if (!before.has(name)) await api('DELETE', `/api/v1/namespaces/${namespace}/workflowruns/${name}`);
  }
}

let runsBefore = new Set<string>();

/**
 * Point the clone's local "remote" (and origin/main) at HEAD, so there is
 * nothing to push, or at HEAD^1, so a push is waiting.
 */
function setPushed(pushed: boolean): void {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
  const root = git(workspaceFolder(), 'rev-parse', '--show-toplevel');
  const commit = git(root, 'rev-parse', pushed ? 'HEAD' : 'HEAD^1');
  git(path.resolve(root, '..', '.remote', `${path.basename(root)}.git`), 'update-ref', 'refs/heads/main', commit);
  git(root, 'update-ref', 'refs/remotes/origin/main', commit);
}

/** Off camera: the component's source open, the status bar item showing. */
async function openLinkedSource(demo: Demo): Promise<Locator> {
  await tidy(demo);
  await demo.command('View: Show Explorer');
  await widenSidebar(demo.page, 420);
  // The repository, or just the component's app folder.
  const inApp = path.basename(workspaceFolder()) === LINKED.appFolder;
  await demo.openFile(inApp ? 'main.go' : `${LINKED.appFolder}/main.go`);
  const link = statusItem(demo.page, 'openchoreo.linkedComponent');
  await link.filter({ hasText: LINKED.component }).waitFor({ timeout: 60_000 });
  await demo.command('Collapse Folders in Explorer');
  await demo.command('File: Reveal Active File in Explorer View');
  await parkMouse(demo.page);
  return link;
}

/** Move the mouse off the status bar and close the linked component's tooltip if it opened. */
async function dismissHover(page: Page): Promise<void> {
  await parkMouse(page);
  if (await page.locator('.monaco-hover').filter({ hasText: 'Linked OpenChoreo components' }).isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
  }
}

/** Open the linked component's actions from the status bar (choosing the component when several link). */
async function openActions(demo: Demo, page: Page): Promise<void> {
  await demo.click(statusItem(page, 'openchoreo.linkedComponent'));
  await quickInput(page).waitFor({ state: 'visible', timeout: 15_000 });
  if (await quickItem(page, LINKED.component).isVisible().catch(() => false)) await pick(demo, LINKED.component);
  await quickItem(page, /Open Component YAML/).waitFor({ timeout: 15_000 });
}

/**
 * The status bar knows which components the open repository builds; their
 * actions are one click away. Workspace: innerloop/sample-workloads (the whole
 * repository: greeting-service and the latency-lab components link).
 */
export const linkedComponent: Scene = {
  name: 'linked-component',
  title: 'Linked component: the status bar knows which component your code builds, with its actions one click away',
  requires: ['cluster'],
  async setup(demo) {
    setPushed(true);
    await openLinkedSource(demo);
    await statusText(demo.page, /\d+↑/).waitFor({ state: 'hidden', timeout: 30_000 });
  },
  async run(demo) {
    const page = demo.page;
    const link = statusItem(page, 'openchoreo.linkedComponent');
    await demo.pause(700);
    await demo.mark('status', link);
    // Hover: the tooltip names the linked component, its project, branch and app path.
    const box = await link.boundingBox();
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
    const hover = page.locator('.monaco-hover').filter({ hasText: 'Linked OpenChoreo components' }).first();
    await hover.waitFor({ timeout: 10_000 });
    await demo.mark('linked', hover);
    await demo.pause(1400);
    await openActions(demo, page);
    await parkMouse(page);
    await demo.pause(600);
    await demo.mark('key', quickInput(page));
    await demo.pause(1800);
    await demo.screenshot('actions');
    await demo.pause(600);
  },
};

/**
 * Build This Commit from the status bar, then the build followed there.
 * Workspace: innerloop/sample-workloads/service-go-greeter (only greeting-service
 * links), with "git.openRepositoryInParentFolders": "always". Capture it on its own
 * (the build status item stays in the status bar).
 */
export const buildThisCommit: Scene = {
  name: 'build-this-commit',
  title: 'Build This Commit: build the commit you are on and follow the build in the status bar',
  requires: ['cluster'],
  async setup(demo) {
    runsBefore = await runNames();
    setPushed(true);
    await openLinkedSource(demo);
    await statusText(demo.page, /\d+↑/).waitFor({ state: 'hidden', timeout: 30_000 });
  },
  async run(demo) {
    const page = demo.page;
    await demo.pause(700);
    await openActions(demo, page);
    await demo.pause(600);
    await pick(demo, /Build This Commit/);
    await dismissHover(page);
    const building = statusText(page, new RegExp(`${LINKED.component}: building`));
    await building.waitFor({ timeout: 30_000 });
    // The status bar tooltip can open late, after the click on the status bar.
    await dismissHover(page);
    await demo.pause(600);
    await demo.mark('key', building);
    // The phase joins the text once the workflow run reports it.
    await statusText(page, /building \w+ \(/).waitFor({ timeout: 15_000 }).catch(() => undefined);
    await demo.pause(1800);
    await demo.screenshot('build-followed');
    await demo.pause(600);
  },
  async teardown() {
    await deleteRunsSince(runsBefore);
  },
};

/**
 * Push a linked branch: the extension offers a build of the pushed commit (the
 * component has no auto-build) and follows it. Workspace:
 * innerloop/sample-workloads/service-go-greeter (pushes go to a local bare
 * repository), with "git.openRepositoryInParentFolders": "always" and "git.autofetch": false.
 * Capture it on its own: a build status item from another scene would show in it.
 */
export const followAfterPush: Scene = {
  name: 'follow-after-push',
  title: 'Follow the build after a push: push, build the pushed commit, watch it in the status bar',
  requires: ['cluster'],
  async setup(demo) {
    runsBefore = await runNames();
    setPushed(true);
    await openLinkedSource(demo);
    // VS Code asks about periodic fetches after the first push of a profile: answer it off camera.
    await demo.command('Git: Push');
    const no = demo.page.locator('.notification-toast').filter({ hasText: /periodically run/ }).getByRole('button', { name: 'No' });
    if (await no.waitFor({ timeout: 8_000 }).then(() => true, () => false)) await no.click();
    setPushed(false);
    await statusText(demo.page, /\d+↑/).waitFor({ timeout: 30_000 });
    await demo.command('Notifications: Clear All Notifications');
  },
  async run(demo) {
    const page = demo.page;
    await demo.pause(800);
    await demo.mark('ahead', statusText(page, /\d+↑/));
    await demo.command('Git: Push');
    const build = page.getByRole('button', { name: `Build ${LINKED.component}` });
    await build.waitFor({ timeout: 30_000 });
    await demo.pause(900);
    await demo.click(build);
    await dismissHover(page);
    const building = statusText(page, new RegExp(`${LINKED.component}: building`));
    await building.waitFor({ timeout: 30_000 });
    // The status bar tooltip can open late, after the click on the status bar.
    await dismissHover(page);
    await demo.pause(600);
    await demo.mark('key', building);
    await statusText(page, /building \w+ \(/).waitFor({ timeout: 15_000 }).catch(() => undefined);
    await demo.pause(1800);
    await demo.screenshot('build-after-push');
    await demo.pause(600);
  },
  async teardown() {
    await deleteRunsSince(runsBefore);
  },
};

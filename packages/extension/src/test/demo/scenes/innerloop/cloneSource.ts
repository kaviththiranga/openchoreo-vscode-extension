// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as fs from 'fs';
import * as path from 'path';
import type { Scene } from '../../demo';
import { contextMenu, parkMouse, quickInput, resetWorkbench, statusItem, treeRow, workspaceFolder } from './helpers';
import { LINKED } from './linkedComponent';
import { revealComponent } from './tree';

const REPO = 'https://github.com/openchoreo/sample-workloads';

/**
 * Clone Source: right-click a source-built component → its repository is
 * cloned at the branch it builds from, added to the window with the app folder
 * revealed, and the status bar links it. Workspace: the multi-root
 * innerloop/url-shortener.code-workspace (adding a folder to it doesn't restart
 * the extension host; setup puts it back to snip-digest alone).
 * Settings: "files.simpleDialog.enable": true (the folder picker renders in
 * the page) and "git.defaultCloneDirectory": "/tmp/src" - a neutral path, because the picker
 * shows it in full (VS Code's throwaway home lives under a long temp path).
 */
const CLONE_DIR = process.env.DEMO_CLONE_DIR ?? '/tmp/src';
export const cloneSource: Scene = {
  name: 'clone-source',
  title: 'Clone Source: clone a component\'s repository at its build branch, app folder revealed',
  requires: ['cluster'],
  async setup(demo) {
    // An empty clone directory, and git (in VS Code's throwaway home) told to fetch the
    // repository from the seed script's local copy so the clone is instant.
    const home = await demo.app.evaluate(() => process.env.HOME ?? '');
    if (!home) throw new Error('no HOME for VS Code');
    fs.rmSync(CLONE_DIR, { recursive: true, force: true });
    fs.mkdirSync(CLONE_DIR, { recursive: true });
    const mirror = process.env.DEMO_CLONE_MIRROR ?? path.resolve(workspaceFolder(), '..', '.mirror', 'sample-workloads.git');
    if (fs.existsSync(mirror)) {
      const gitconfig = path.join(home, '.gitconfig');
      const current = fs.existsSync(gitconfig) ? fs.readFileSync(gitconfig, 'utf8') : '';
      if (!current.includes(mirror)) fs.appendFileSync(gitconfig, `[url "file://${mirror}"]\n\tinsteadOf = ${REPO}\n`);
    }
    const workspace = workspaceFolder();
    if (!workspace.endsWith('.code-workspace')) throw new Error('open innerloop/url-shortener.code-workspace');
    const original = `${JSON.stringify({ folders: [{ path: 'snip-digest' }] }, null, 2)}\n`;
    if (fs.readFileSync(workspace, 'utf8') !== original) {
      fs.writeFileSync(workspace, original);
      await demo.page.locator('.explorer-folders-view .monaco-list-row', { hasText: /^sample-workloads$/ }).waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined);
    }
    await resetWorkbench(demo);
    await revealComponent(demo, 'default', LINKED.component);
    await parkMouse(demo.page);
  },
  async run(demo) {
    const page = demo.page;
    const component = treeRow(page, LINKED.component);
    await demo.pause(700);
    const clone = await contextMenu(demo, component, 'Clone Source');
    await demo.pause(500);
    await demo.click(clone);
    // The folder picker: accept the default parent folder.
    const ok = quickInput(page).getByRole('button', { name: 'Clone Here' });
    await ok.waitFor({ timeout: 15_000 });
    await demo.pause(700);
    await demo.click(ok);
    const add = page.getByRole('button', { name: 'Add to Workspace' });
    await add.waitFor({ timeout: 120_000 });
    await demo.pause(700);
    await demo.click(add);
    await parkMouse(page);
    // The app folder revealed and its workload.yaml opened.
    await page.locator('.breadcrumbs-control', { hasText: 'service-go-greeter' }).first().waitFor({ timeout: 30_000 });
    const link = statusItem(page, 'openchoreo.linkedComponent');
    await link.filter({ hasText: LINKED.component }).waitFor({ timeout: 30_000 });
    await demo.pause(600);
    await demo.mark('key', page.locator('.part.sidebar'));
    await demo.pause(1600);
    await demo.screenshot('cloned-and-linked');
    await demo.pause(600);
  },
};

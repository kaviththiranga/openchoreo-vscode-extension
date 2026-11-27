// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { Scene } from '../../demo';
import { until } from '../../cluster';
import { dialogButton, discardDirtyEditors, parkMouse, widenSidebar } from './sidebar';

/**
 * Scaffold a Component and Workload from plain source: the extension spots a
 * Flask service with a Dockerfile, previews both manifests, writes them to
 * .openchoreo/ and commits them. Open the reading-list-service folder from
 * demo/seed/workspaces-explore.sh (DEMO_WORKSPACE); setup resets it.
 */
export const scaffoldFromSource: Scene = {
  name: 'scaffold-from-source',
  title: 'Scaffold Component and Workload manifests from a Flask service\'s source',
  requires: ['cluster'],
  async setup(demo) {
    const page = demo.page;
    const workspace = process.env.DEMO_WORKSPACE;
    if (!workspace || !fs.existsSync(path.join(workspace, 'requirements.txt'))) {
      throw new Error('set DEMO_WORKSPACE to the reading-list-service folder from demo/seed/workspaces-explore.sh');
    }
    // Back to the first commit, without .openchoreo/.
    const git = (...args: string[]) => execFileSync('git', ['-C', workspace, ...args], { encoding: 'utf8' }).trim();
    const root = git('rev-list', '--max-parents=0', 'HEAD').split('\n')[0];
    git('reset', '-q', '--hard', root);
    git('clean', '-fdq');
    await discardDirtyEditors(demo);
    await demo.command('View: Show Explorer');
    await page.locator('.explorer-folders-view').waitFor({ timeout: 30_000 });
    await widenSidebar(page, 380);
    await page.locator('.explorer-folders-view .monaco-list-row', { hasText: 'requirements.txt' }).waitFor({ timeout: 30_000 });
    await parkMouse(page);
  },
  async run(demo) {
    const page = demo.page;
    await demo.pause(600);
    // The palette, filtered just far enough to pick the command.
    await demo.press('F1');
    await demo.pause(300);
    await demo.type('OpenChoreo: Scaffold', 35);
    await page.locator('.quick-input-list .monaco-list-row.focused', { hasText: 'Scaffold Component from this Project' }).waitFor({ timeout: 15_000 });
    await demo.pause(400);
    await page.keyboard.press('Enter');
    const detected = page.locator('.monaco-dialog-box', { hasText: 'Detected:' });
    await detected.waitFor({ timeout: 30_000 });
    await demo.mark('detected', detected);
    await demo.pause(900);
    await demo.screenshot('detected');
    await demo.pause(500);
    await demo.click(dialogButton(page, 'Scaffold'));

    const confirm = page.locator('.monaco-dialog-box', { hasText: 'Save manifests to' });
    await confirm.waitFor({ timeout: 30_000 });
    await demo.pause(500);
    await demo.screenshot('preview');
    await demo.click(dialogButton(page, 'Save'));

    // The previews give way to the written files; the Explorer shows them, new to git.
    await until(async () => (await page.locator('.tab.dirty').count()) === 0, 30_000, 300);
    await page.locator('.tab', { hasText: 'workload.yaml' }).first().waitFor({ timeout: 30_000 });
    const files = page.locator('.explorer-folders-view');
    const folder = files.locator('.monaco-list-row', { hasText: '.openchoreo' }).first();
    await folder.waitFor({ timeout: 30_000 });
    if ((await folder.getAttribute('aria-expanded')) !== 'true') {
      await demo.pause(300);
      await demo.click(folder);
    }
    await files.locator('.monaco-list-row', { hasText: 'workload.yaml' }).waitFor({ timeout: 15_000 });
    await demo.pause(700);

    // And commits them.
    const toast = page.locator('.notification-toast', { hasText: 'Commit them to git now?' });
    await toast.waitFor({ timeout: 15_000 });
    await demo.click(toast.locator('.monaco-button', { hasText: /^Commit$/ }));
    const committed = page.locator('.notification-toast', { hasText: 'Committed OpenChoreo manifests.' });
    await committed.waitFor({ timeout: 60_000 });
    await demo.pause(300);
    await demo.mark('key', files);
    await demo.mark('toast', committed);
    await demo.pause(1500);
    await demo.screenshot('committed');
  },
};

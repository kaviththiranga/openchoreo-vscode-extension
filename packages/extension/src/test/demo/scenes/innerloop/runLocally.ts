// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as path from 'path';
import type { Scene } from '../../demo';
import { contextMenu, parkMouse, pick, presetPanel, resetWorkbench, terminalRow, waitForTerminal, widenSidebar, workspaceFolder } from './helpers';
import { seedLinks } from './tunnels';

/**
 * Run Locally Against Environment: a shell whose variables point at tunnels
 * to the development environment; `npm start` there talks to the real services.
 * Workspace: innerloop/snip-digest. Needs terminal.integrated.gpuAcceleration "off".
 */
export const runLocally: Scene = {
  name: 'run-locally',
  title: 'Run Locally Against Environment: a shell wired to the environment\'s real dependencies',
  requires: ['cluster'],
  async setup(demo) {
    const page = demo.page;
    await seedLinks(path.join(workspaceFolder(), 'workload.yaml'), 'development');
    await resetWorkbench(demo);
    await presetPanel(demo, true);
    await demo.command('View: Show Explorer');
    await widenSidebar(page, 420);
    await demo.openFile('digest.js');
    await parkMouse(page);
  },
  async run(demo) {
    const page = demo.page;
    const workload = page.locator('.explorer-folders-view .monaco-list-row').filter({ hasText: /^workload\.yaml$/ }).first();
    await workload.waitFor({ timeout: 15_000 });
    await demo.pause(600);
    const run = await contextMenu(demo, workload, 'Run Locally Against Environment');
    await demo.pause(500);
    await demo.click(run);
    await pick(demo, 'development');
    await pick(demo, 'Open a shell wired to the environment');
    await parkMouse(page);

    const terminal = page.locator('.terminal-wrapper.active');
    await waitForTerminal(page, /Tunnels open|subshell|exit to disconnect/i, 60_000);
    await demo.mark('tunnels', terminal);
    await demo.pause(500);
    await page.locator('.terminal-wrapper.active .xterm').click();
    await parkMouse(page);
    await demo.type('node digest.js', 45);
    await demo.pause(300);
    await page.keyboard.press('Enter');
    await waitForTerminal(page, /\d+ links, \d+ clicks[\s\S]*➜/, 30_000);
    await demo.pause(300);
    // The app's first line: links and clicks read through the tunnels.
    await demo.mark('key', terminalRow(page, /links,\s\d+\sclicks/));
    await demo.mark('result', terminal);
    await demo.pause(1500);
    await demo.screenshot('app-against-development');
    await demo.pause(300);
  },
  async teardown(demo) {
    // Closes the occ remote session and its tunnels off camera.
    await demo.command('Terminal: Kill All Terminals');
  },
};

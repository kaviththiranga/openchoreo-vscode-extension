// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import { contextMenu, parkMouse, presetPanel, resetWorkbench, terminalRow, treeNode, treeRow, waitForTerminal } from './helpers';
import { revealComponent } from './tree';

/**
 * Open Shell: right-click a deployed environment of snip-api-service → an
 * interactive shell in its running pod. Any workspace (innerloop/snip-digest).
 * Needs terminal.integrated.gpuAcceleration "off".
 */
export const openShell: Scene = {
  name: 'open-shell',
  title: 'Open Shell: an interactive shell in a component\'s running pod, from the sidebar',
  requires: ['cluster'],
  async setup(demo) {
    await resetWorkbench(demo);
    await presetPanel(demo, true);
    await revealComponent(demo, 'url-shortener', 'snip-api-service', { bindings: true });
    await parkMouse(demo.page);
  },
  async run(demo) {
    const page = demo.page;
    const environment = treeRow(page, 'development', treeNode(page, 'snip-api-service'));
    await environment.waitFor({ timeout: 15_000 });
    await demo.pause(700);
    const open = await contextMenu(demo, environment, 'Open Shell');
    await demo.pause(500);
    await demo.click(open);
    await parkMouse(page);

    const terminal = page.locator('.terminal-wrapper.active');
    // The pod's shell prompt (busybox sh in the alpine image).
    await waitForTerminal(page, /^\/app\s*[#$]\s*$/m, 60_000);
    // Keyboard focus can stay in the sidebar webview after its context menu.
    await page.locator('.terminal-wrapper.active .xterm').click();
    await parkMouse(page);
    await demo.pause(700);
    await demo.type('hostname && ls && wget -qO- localhost:8080/health', 45);
    await demo.pause(300);
    await page.keyboard.press('Enter');
    await waitForTerminal(page, /"status":"ok"/, 20_000);
    await demo.pause(500);
    await demo.mark('key', terminalRow(page, /^snip-api-service-development/));
    await demo.mark('result', terminal);
    await demo.pause(1600);
    await demo.screenshot('shell-in-pod');
    await demo.pause(600);
  },
  async teardown(demo) {
    // Ends the shell session (and its occ process) off camera.
    await demo.command('Terminal: Kill All Terminals');
  },
};

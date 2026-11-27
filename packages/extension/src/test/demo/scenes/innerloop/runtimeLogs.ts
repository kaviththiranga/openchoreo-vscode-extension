// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as path from 'path';
import type { Scene } from '../../demo';
import { contextMenu, parkMouse, pick, presetPanel, quickInput, resetWorkbench, treeNode, treeRow, workspaceFolder } from './helpers';
import { revealComponent } from './tree';
import { seedLinks } from './tunnels';

/**
 * View Runtime Logs: right-click a deployed environment → a time window and a
 * filter → the observability plane's logs in an Output channel, with pod and level.
 * Workspace: innerloop/snip-digest (its workload.yaml makes fresh log lines in setup).
 */
export const runtimeLogs: Scene = {
  name: 'runtime-logs',
  title: 'View Runtime Logs: logs from the observability plane, filtered, with pod and level',
  requires: ['cluster'],
  async setup(demo) {
    await seedLinks(path.join(workspaceFolder(), 'workload.yaml'), 'development');
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
    const logs = await contextMenu(demo, environment, 'View Runtime Logs');
    await demo.pause(500);
    await demo.click(logs);
    await pick(demo, 'Last 15 minutes');
    // Optional text filter.
    await quickInput(page).locator('input').waitFor({ timeout: 10_000 });
    await demo.pause(600);
    await demo.type('/r/', 90);
    await demo.pause(500);
    await page.keyboard.press('Enter');
    await parkMouse(page);

    const output = page.locator('.part.panel .view-lines');
    await output.filter({ hasText: /path=\/r\// }).first().waitFor({ timeout: 60_000 });
    await demo.pause(700);
    await demo.mark('key', page.locator('.part.panel'));
    await demo.pause(1800);
    await demo.screenshot('runtime-logs');
    await demo.pause(600);
  },
};

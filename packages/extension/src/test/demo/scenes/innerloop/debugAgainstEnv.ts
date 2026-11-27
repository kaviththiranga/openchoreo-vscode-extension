// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as path from 'path';
import type { Page } from 'playwright-core';
import type { Demo, Scene } from '../../demo';
import { contextMenu, parkMouse, pick, presetPanel, quickItem, resetWorkbench, statusItem, widenSidebar, workspaceFolder } from './helpers';
import { seedLinks } from './tunnels';

/**
 * Debug Against Environment: snip-digest (a new url-shortener component that
 * isn't deployed yet) stops at a breakpoint holding live data that came
 * through tunnels to the development environment's services.
 * Workspace: demo/seed/workspaces-innerloop.sh → innerloop/snip-digest. With
 * "openchoreo.localDev.keepTunnelsOpen": true the setup's warm-up tunnels are
 * reused, so the debugger starts without waiting for occ remote.
 */
export const debugAgainstEnv: Scene = {
  name: 'debug-against-env',
  title: 'Debug Against Environment: breakpoint in local code, live data from the environment through tunnels',
  requires: ['cluster'],
  async setup(demo) {
    const page = demo.page;
    await seedLinks(path.join(workspaceFolder(), 'workload.yaml'), 'development');
    await resetWorkbench(demo);
    await presetPanel(demo, false);
    await demo.command('View: Show Explorer');
    await widenSidebar(page, 600);
    await demo.openFile('digest.js');
    await demo.goTo(11);
    await page.keyboard.press('F9');
    await page.locator('.codicon-debug-breakpoint').first().waitFor({ timeout: 10_000 });
    // Warm up once off camera (API login, the JavaScript debugger), then start clean.
    await demo.command('OpenChoreo: Debug Against Environment');
    await quickItem(page, 'development').waitFor({ timeout: 30_000 });
    await page.keyboard.press('Enter');
    await showLocals(page);
    // Room for the variables: fold the debug view's other sections (VS Code keeps this).
    for (const name of ['Watch', 'Loaded Scripts', 'Breakpoints']) {
      const header = page.locator(`.pane-header[aria-label^="${name} Section"]`).first();
      if ((await header.getAttribute('aria-expanded').catch(() => null)) === 'true') await header.click();
    }
    await resetWorkbench(demo, { keepBreakpoints: true });
    await demo.command('Notifications: Clear All Notifications');
    await demo.command('View: Show Explorer');
    await demo.goTo(1);
    await parkMouse(page);
  },
  async run(demo) {
    const page = demo.page;
    const workload = page.locator('.explorer-folders-view .monaco-list-row').filter({ hasText: /^workload\.yaml$/ }).first();
    await workload.waitFor({ timeout: 15_000 });
    await demo.pause(600);
    const debug = await contextMenu(demo, workload, 'Debug Against Environment');
    await demo.pause(500);
    await demo.click(debug);
    await pick(demo, 'development');
    await parkMouse(page);

    // Tunnels open, the debugger starts with the bindings in its env and stops at the breakpoint.
    const variables = variablesPane(page);
    const row = (name: string) => variablesRow(page, name);
    await showLocals(page, demo);
    await demo.pause(900);
    await demo.mark('tunnels', statusItem(page, 'openchoreo.tunnels'));
    await demo.click(row('digest').locator('.monaco-tl-twistie'));
    await row('total_clicks').waitFor({ timeout: 10_000 });
    await parkMouse(page);
    await demo.pause(400);
    await demo.mark('key', variables);
    await demo.pause(1600);
    await demo.screenshot('breakpoint-variables');
    await demo.pause(800);
  },
  async teardown(demo) {
    await resetWorkbench(demo, { keepBreakpoints: true });
  },
};

function variablesPane(page: Page) {
  return page.locator('.pane').filter({ has: page.locator('.pane-header', { hasText: /^Variables/ }) }).first();
}

/**
 * Wait for the paused frame's locals. VS Code usually expands the Local scope
 * by itself; when it doesn't (busy host), expand it, with the cursor on camera.
 */
async function showLocals(page: Page, demo?: Demo): Promise<void> {
  const scope = variablesPane(page).locator('.monaco-list-row').filter({ hasText: /^\s*Local:/ }).first();
  await scope.waitFor({ timeout: 90_000 });
  const url = variablesRow(page, 'url');
  if (await url.waitFor({ timeout: 3_000 }).then(() => false, () => true)) {
    if ((await scope.getAttribute('aria-expanded')) === 'false') {
      const twistie = scope.locator('.monaco-tl-twistie');
      if (demo) await demo.click(twistie);
      else await twistie.click();
    }
  }
  await url.waitFor({ timeout: 30_000 });
}

/** A row of the Variables view by the variable's name. */
function variablesRow(page: Page, name: string) {
  return variablesPane(page).locator('.monaco-list-row').filter({ hasText: new RegExp(`^\\s*${name}\\b`) }).first();
}

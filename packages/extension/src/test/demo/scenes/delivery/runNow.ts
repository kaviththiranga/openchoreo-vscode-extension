// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import { CRON } from './data';
import { closePanel, Sidebar } from './sidebar';

/**
 * Run a scheduled task now: a one-off Job starts from the CronJob and shows
 * up under the environment's deployed resources.
 */
export const runNow: Scene = {
  name: 'run-now',
  title: 'Run Now: start a one-off Job of a scheduled task and see it in the deployed resources',
  requires: ['cluster'],
  async setup(demo) {
    await closePanel(demo);
    const sb = new Sidebar(demo);
    // Wide enough for the Job names.
    await sb.showComponent(CRON.project, CRON.component, ['Release Bindings'], 700);
  },
  async run(demo) {
    const page = demo.page;
    const sb = new Sidebar(demo);
    const bindings = sb.node('Release Bindings', sb.node(CRON.component));

    await sb.menu(sb.row(CRON.environment, bindings), 'Run Now (Scheduled Task)');
    const toast = page.locator('.notifications-toasts .notification-toast', { hasText: /Started job/ }).first();
    await toast.waitFor({ timeout: 20_000 });
    const job = /Started job (\S+)/.exec((await toast.textContent()) ?? '')?.[1]?.replace(/[.,]$/, '');
    await demo.pause(1000);
    await demo.mark('toast', toast);

    // The environment's resource tree, fetched now: CronJob → the new Job → its Pod.
    const env = await sb.expand(CRON.environment, bindings, true);
    await demo.pause(600);
    const cron = await sb.expand('CronJob', env, true);
    const jobRow = cron.locator(':scope > .tree-children > .tree-node > .tree-row', {
      has: sb.frame.locator('.tree-description', { hasText: job ?? /manual/ }),
    }).first();
    await jobRow.waitFor({ timeout: 20_000 });
    await demo.pause(700);
    // Its definition: a Job created from the CronJob's template.
    await demo.click(jobRow);
    await demo.page.locator('.editor-group-container .monaco-editor .view-line', { hasText: 'kind: Job' }).first().waitFor({ timeout: 20_000 });
    await demo.pause(900);
    await demo.mark('key', jobRow);
    await demo.screenshot('job-started');
    await demo.pause(1500);
  },
};

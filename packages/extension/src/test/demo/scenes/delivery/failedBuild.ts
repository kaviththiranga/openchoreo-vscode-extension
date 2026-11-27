// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import { failed, workflowRuns } from './cluster';
import { FAILED } from './data';
import { maximizeNextPanel, outputView, Sidebar } from './sidebar';

let failedRun = '';

/** A failed build: the red step in the run, and that step's logs with the error. */
export const failedBuild: Scene = {
  name: 'failed-build',
  title: 'Failed build: the failing step in red and its step logs in the Output panel',
  requires: ['cluster'],
  async setup(demo) {
    const runs = await workflowRuns(FAILED.project, FAILED.component);
    const last = runs.filter(failed).pop();
    if (!last) throw new Error(`${FAILED.component} has no failed workflow run`);
    failedRun = last.metadata!.name!;
    await maximizeNextPanel(demo);
    const sb = new Sidebar(demo);
    await sb.showComponent(FAILED.project, FAILED.component, ['Workflow Runs']);
  },
  async run(demo) {
    const sb = new Sidebar(demo);
    const runs = sb.node('Workflow Runs', sb.node(FAILED.component));
    const run = await sb.expand(failedRun, runs, true);
    const failedStep = run.locator(':scope > .tree-children > .tree-node > .tree-row', {
      has: sb.frame.locator('.tree-description', { hasText: /^(Failed|Error)/ }),
    }).first();
    await failedStep.waitFor();
    await demo.pause(1200);
    await demo.mark('key', failedStep);
    await demo.screenshot('failed-step');

    await sb.menu(failedStep, 'View Step Logs');
    const output = outputView(demo.page);
    const error = output.locator('.view-line', { hasText: FAILED.error }).first();
    await error.waitFor({ timeout: 20_000 });
    await demo.pause(1500);
    await demo.mark('result', error);
    await demo.screenshot('step-logs');
    await demo.pause(800);
  },
};

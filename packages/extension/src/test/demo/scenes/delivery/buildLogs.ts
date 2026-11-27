// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import { until } from '../../cluster';
import { completed, runLogLines, runStatus, startBuild, workflowRuns } from './cluster';
import { BUILD } from './data';
import { maximizeNextPanel, outputView, Sidebar } from './sidebar';

let runName = '';

const phase = async (step: string) => (await runStatus(runName)).steps?.find((s) => s.name === step)?.phase;

/**
 * A build in progress: the tree was opened while the checkout ran, Refresh
 * shows it finished and the image build running, then the image build's logs
 * stream into the Output panel. Setup reuses the build trigger-build started
 * while its checkout still runs, or starts one, and does the waiting off camera.
 */
export const buildLogs: Scene = {
  name: 'build-logs',
  title: 'Workflow run observability: Refresh shows a step finish and the next one run, then its logs stream',
  requires: ['cluster'],
  async setup(demo) {
    await maximizeNextPanel(demo);
    const sb = new Sidebar(demo);
    runName = (await workflowRuns(BUILD.project, BUILD.component)).filter((r) => !completed(r)).pop()?.metadata?.name ?? '';
    for (let attempt = 0; ; attempt++) {
      if (!runName) runName = await startBuild(BUILD.project, BUILD.component);
      await until(async () => ['Running', 'Succeeded', 'Failed', 'Error'].includes((await phase(BUILD.firstStep)) ?? ''), 180_000, 1000);
      if ((await phase(BUILD.firstStep)) === 'Running') {
        // Open the run while the checkout runs: the tree shows it spinning until a refresh.
        const comp = await sb.showComponent(BUILD.project, BUILD.component, ['Workflow Runs']);
        const run = await sb.expand(runName, sb.node('Workflow Runs', comp));
        const running = await sb.row(BUILD.firstStep, run).locator('.tree-description', { hasText: 'Running' })
          .waitFor({ timeout: 5000 }).then(() => true, () => false);
        if (running) break;
      }
      if (attempt >= 1) throw new Error(`could not open ${runName} while ${BUILD.firstStep} ran`);
      // Too late for this build's checkout: let it finish, then start one.
      await until(async () => (await workflowRuns(BUILD.project, BUILD.component)).every(completed), 420_000, 10_000).catch(() => undefined);
      runName = '';
    }
    await sb.parkMouse();
    // Off camera: until the image build streams.
    await until(async () => (await phase(BUILD.logStep)) === 'Running' && (await runLogLines(runName, BUILD.logStep)) >= 15, 240_000, 3000);
  },
  async run(demo) {
    const sb = new Sidebar(demo);
    const run = sb.node(runName, sb.node('Workflow Runs', sb.node(BUILD.component)));
    const first = sb.row(BUILD.firstStep, run);
    await demo.pause(600);
    await demo.mark('before', run);

    // Refresh: the checkout finished (with its time) and the image build runs.
    await sb.refreshButton().hover();
    await demo.click(sb.refreshButton());
    await first.locator('.tree-description', { hasText: /Succeeded/ }).waitFor({ timeout: 20_000 });
    const step = sb.row(BUILD.logStep, run);
    await step.waitFor({ timeout: 20_000 });
    await demo.pause(800);
    await demo.mark('key', run);
    await demo.screenshot('steps');

    // The image build step's own log: build output, in order, as it happens.
    await sb.menu(step, 'View Step Logs');
    const output = outputView(demo.page);
    // Log lines start with their timestamp (the placeholder for no logs doesn't).
    await output.locator('.view-line', { hasText: /^\[\d{4}-/ }).first().waitFor({ timeout: 20_000 });
    await demo.pause(800);
    await demo.mark('logs', output);
    await demo.screenshot('build-logs');
    // New lines keep arriving while the build runs.
    await demo.pause(2500);
  },
};

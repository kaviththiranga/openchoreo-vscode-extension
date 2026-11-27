// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import { until } from '../../cluster';
import { completed, runStatus, workflowRuns } from './cluster';
import { BUILD } from './data';
import { closePanel, Sidebar } from './sidebar';

let before = new Set<string>();

/**
 * Trigger Build on a source-built component: the run appears in the tree with
 * its steps and live status. Build logs only start about 40 s in (after
 * checkout), so build-logs picks the same run up from there.
 */
export const triggerBuild: Scene = {
  name: 'trigger-build',
  title: 'Trigger Build: the workflow run appears in the tree with its steps and live status',
  requires: ['cluster'],
  async setup(demo) {
    // Don't pile builds onto a loaded cluster: let an earlier take's build finish first.
    await until(async () => (await workflowRuns(BUILD.project, BUILD.component)).every(completed), 420_000, 10_000).catch(() => undefined);
    before = new Set((await workflowRuns(BUILD.project, BUILD.component)).map((r) => r.metadata!.name!));
    await closePanel(demo);
    const sb = new Sidebar(demo);
    await sb.showComponent(BUILD.project, BUILD.component, ['Workflow Runs']);
  },
  async run(demo) {
    const sb = new Sidebar(demo);
    const runs = sb.node('Workflow Runs', sb.node(BUILD.component));

    await sb.menu(sb.row(BUILD.component), 'Trigger Build');
    // The new run: a row under Workflow Runs that wasn't there before.
    const labels = runs.locator(':scope > .tree-children > .tree-node > .tree-row .tree-label');
    let runName = '';
    await until(async () => {
      runName = (await labels.allTextContents()).map((l) => l.trim()).find((l) => l.startsWith(`${BUILD.component}-`) && !before.has(l)) ?? '';
      return !!runName;
    }, 20_000, 200);
    const run = sb.node(runName, runs);
    await demo.pause(700);
    await demo.mark('run', run);

    // The run's steps, with live status (once the workflow has created its first step).
    await until(async () => ((await runStatus(runName)).steps ?? []).length > 0, 15_000, 500).catch(() => undefined);
    await sb.expand(runName, runs, true);
    await run.locator(':scope > .tree-children > .tree-node > .tree-row').first().waitFor();
    await demo.pause(900);
    await demo.mark('key', run);
    await demo.screenshot('run-started');
    await demo.pause(1500);
  },
};

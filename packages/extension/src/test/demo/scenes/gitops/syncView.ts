// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import { expandGitOpsRows, gitopsAction, gitopsRow, gitopsTree, glide, hideCursor, hold, parkMouse, showGitOpsView, syncChecked } from './ui';
import { AUTOSCALER, CART, ensureClusterOnlyEnvironment, resetWorkspace, touch } from './workspace';

/** Hover a row's description (the cursor leaves its icon and name readable) and wait for its tooltip. */
async function explain(demo: Parameters<Scene['run']>[0], label: string, tooltip: RegExp): Promise<void> {
  const row = gitopsRow(demo.page, label);
  await glide(demo, row.locator('.label-description'));
  await demo.page.locator('.workbench-hover, .monaco-hover', { hasText: tooltip }).first().waitFor({ timeout: 10_000 });
  await demo.mark(`state:${label}`, row);
  await demo.pause(1400);
}

/**
 * The OpenChoreo GitOps view: every resource the repository declares, checked
 * against the cluster — matching, differing (greeter got an autoscaler), not on
 * the cluster yet (the new cart service), and only on the cluster (an
 * Environment made in the console).
 */
export const gitopsSyncView: Scene = {
  name: 'gitops-sync-view',
  title: 'The OpenChoreo GitOps view: each declared resource matches the cluster, differs, or is not on it yet, plus cluster-only drift',
  requires: ['cluster', 'gitops-workspace'],
  teardown: async () => resetWorkspace(),
  async setup(demo) {
    const page = demo.page;
    await ensureClusterOnlyEnvironment();
    await showGitOpsView(demo, 800);
    // Cluster-scoped kinds belong to the platform team; keep the namespace in focus.
    await expandGitOpsRows(page, ['(cluster-scoped)', 'ComponentRelease', 'ProjectReleaseBinding', 'ReleaseBinding'], false);
    await expandGitOpsRows(page, ['Component', 'DeploymentPipeline', 'Environment', 'Project', 'Workload']);
    resetWorkspace({ ...AUTOSCALER, ...CART });
    // Check Sync rescans the workspace, but a watcher that just started can still lag behind
    // the edits: write them again until the view lists cart and shows greeter differing.
    for (let attempt = 0; ; attempt++) {
      await demo.command('OpenChoreo: Check Sync with Cluster');
      await page.waitForTimeout(1000);
      const settled = await syncChecked(page, 20_000)
        .then(() => gitopsRow(page, 'cart').waitFor({ timeout: 5_000 }))
        .then(() => gitopsRow(page, 'greeter').locator('.codicon-diff').waitFor({ timeout: 10_000 }))
        .then(() => true, () => false);
      if (settled) break;
      if (attempt === 4) throw new Error('the GitOps view never showed the edited greeter and the new cart as checked');
      touch([...Object.keys(AUTOSCALER), ...Object.keys(CART)]);
      await page.waitForTimeout(2000);
    }
    await gitopsRow(page, 'qa').waitFor({ timeout: 30_000 });
    // No focus outline on the last row expanded.
    await demo.command('View: Focus Active Editor Group');
    await parkMouse(page);
  },
  async run(demo) {
    const page = demo.page;
    await demo.pause(700);
    await demo.click(gitopsAction(page, 'Check Sync with Cluster'));
    await page.waitForTimeout(1200);
    await syncChecked(page);
    await gitopsRow(page, 'qa').waitFor({ timeout: 30_000 });
    await demo.mark('key', gitopsTree(page));
    await demo.pause(900);
    await explain(demo, 'greeter', /Differs from the cluster/);
    await explain(demo, 'cart', /Not on the cluster/);
    await explain(demo, 'qa', /no file in the repository declares it/);
    await hold(demo, 'sync-view', 900);
    await hideCursor(demo);
    await demo.pause(800);
  },
};

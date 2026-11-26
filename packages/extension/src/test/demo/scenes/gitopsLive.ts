// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../demo';

/**
 * A Flux-managed namespace end to end: the GitOps view's sync states, the
 * sidebar badge, the save guard with Change in Repository, and a promotion
 * generated into the repository. Needs a cluster whose Flux syncs the
 * workspace's repository, and an occ context on that namespace:
 *   DEMO_WITH=cluster,gitops-workspace DEMO_WORKSPACE=<clone> OCC_CONFIG=<config> \
 *   DEMO_SCENES=gitops-live pnpm demo:capture
 */
export const gitopsLive: Scene = {
  name: 'gitops-live',
  title: 'GitOps with Flux: sync states, managed badges, the save guard and promotion in the repository',
  requires: ['cluster', 'gitops-workspace'],
  async run(demo) {
    const page = demo.page;
    /** Fold the other namespaces and open gitops-demo's Components and ReleaseBindings. */
    const showGitOpsDemo = async () => {
      await page.getByRole('treeitem', { name: /^gitops-demo/ }).first().waitFor({ timeout: 30_000 });
      const toggle = async (name: RegExp, open: boolean, which: 'first' | 'last' = 'first') => {
        const item = page.getByRole('treeitem', { name })[which]();
        if (((await item.getAttribute('aria-expanded')) === 'true') !== open) await demo.click(item.locator('.monaco-tl-twistie'));
      };
      await toggle(/^\(cluster-scoped\)/, false);
      await toggle(/^default/, false);
      await toggle(/^gitops-demo/, true);
      await toggle(/^Component\b/, true, 'last');
      await toggle(/^ReleaseBinding\b/, true, 'last');
    };
    await demo.command('View: Show Explorer');
    // Off camera in spirit: a wider side bar and the file tree folded away.
    const sash = page.locator('.primary-sidebar-sash').first();
    const box = await sash.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(560, box.y + box.height / 2, { steps: 5 });
      await page.mouse.up();
    }
    const files = page.locator('.pane-header', { hasText: /gitops-ws/i }).first();
    await demo.pause(500);
    if ((await files.getAttribute('aria-expanded')) === 'true') await files.click({ position: { x: 40, y: 14 } });
    const header = page.locator('.pane-header', { hasText: /OpenChoreo GitOps/i }).first();
    await header.waitFor({ timeout: 30_000 });
    if ((await header.getAttribute('aria-expanded')) !== 'true') await demo.click(header);
    await demo.command('OpenChoreo: Check Sync with Cluster');
    await showGitOpsDemo();
    await demo.pause(4000);
    await demo.screenshot('sync-view');

    await demo.click(page.locator('.activitybar [aria-label^="OpenChoreo"]').first());
    const sidebar = page.frameLocator('iframe.webview').first().frameLocator('iframe').first();
    const row = (label: string | RegExp) => sidebar.locator('.tree-row', { has: sidebar.locator('.tree-label', { hasText: label }) }).first();
    await row(/^shop$/).waitFor({ timeout: 30_000 });
    await demo.click(row(/^shop$/).locator('.tree-chevron'));
    const greeter = row(/^greeter$/);
    await greeter.or(row(/^Components/)).first().waitFor({ timeout: 30_000 });
    if (!(await greeter.isVisible())) await demo.click(row(/^Components/).locator('.tree-chevron'));
    await greeter.waitFor({ timeout: 30_000 });
    await demo.pause(1200);
    await demo.screenshot('sidebar-badges');

    // A change through the API would be reverted by Flux at the next sync.
    await demo.click(greeter);
    await page.locator('.monaco-editor .view-lines', { hasText: 'dockerfile-builder' }).first().waitFor({ timeout: 30_000 });
    await demo.pause(1000);
    await demo.press('Control+F');
    await demo.type('branch: main', 40);
    await page.keyboard.press('Escape');
    await demo.type('branch: develop', 60);
    await demo.pause(600);
    await demo.press('Control+S');
    const repoButton = page.getByRole('button', { name: 'Change in Repository' });
    await repoButton.waitFor({ timeout: 30_000 });
    await demo.pause(1200);
    await demo.screenshot('save-guard');
    await demo.click(repoButton);
    await page.getByText(/ready to commit/).first().waitFor({ timeout: 30_000 });
    await demo.pause(1500);
    await demo.screenshot('changed-in-repository');
    await demo.command('View: Close All Editors');
    await demo.pause(800);

    // The repository now differs from the cluster until the change merges.
    await demo.command('View: Show Explorer');
    await demo.command('OpenChoreo: Check Sync with Cluster');
    await showGitOpsDemo();
    await demo.pause(4000);
    await demo.screenshot('differs');

    // Promote to staging: occ writes the ReleaseBinding into the repository.
    await demo.command('OpenChoreo: Promote in Repository');
    const quick = page.locator('.quick-input-widget');
    for (const answer of ['staging', 'standard', 'Component greeter']) {
      await quick.waitFor({ state: 'visible', timeout: 15_000 });
      await quick.locator('input').fill(answer);
      await demo.pause(900);
      await page.keyboard.press('Enter');
      await demo.pause(600);
    }
    const commit = page.getByRole('button', { name: 'Commit on a New Branch' });
    await commit.waitFor({ timeout: 60_000 });
    await demo.pause(1500);
    await demo.screenshot('promoted');
    await demo.click(commit);
    for (let i = 0; i < 2; i++) {
      await quick.waitFor({ state: 'visible', timeout: 15_000 });
      await demo.pause(900);
      await page.keyboard.press('Enter');
    }
    await page.getByRole('button', { name: 'Push and Open Pull Request' }).waitFor({ timeout: 30_000 });
    await demo.pause(1500);
    await demo.screenshot('committed');
  },
};

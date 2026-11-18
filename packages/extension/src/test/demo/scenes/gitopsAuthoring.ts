// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../demo';

/**
 * The GitOps view and releases generated into the repository with occ in
 * file-system mode. Needs no cluster, but writes files: run it on a throwaway
 * clone of openchoreo/sample-gitops.
 *   git clone https://github.com/openchoreo/sample-gitops /tmp/sample-gitops
 *   DEMO_WORKSPACE=/tmp/sample-gitops DEMO_SCENES=gitops-authoring pnpm demo:capture
 */
export const gitopsAuthoring: Scene = {
  name: 'gitops-authoring',
  title: 'GitOps repository view, and ComponentReleases generated into the repository by occ',
  requires: ['gitops-workspace'],
  async run(demo) {
    await demo.caption('Your GitOps repository, resource by resource');
    await demo.command('View: Show Explorer');
    const header = demo.page.locator('.pane-header', { hasText: /OpenChoreo GitOps/i }).first();
    await header.waitFor({ timeout: 30_000 });
    if ((await header.getAttribute('aria-expanded')) !== 'true') await demo.click(header);
    await demo.page.getByRole('treeitem', { name: /^default/ }).first().waitFor({ timeout: 30_000 });
    await demo.pause(1200);
    await demo.screenshot('gitops-view');

    await demo.caption('Generate releases in the repository, ready for a pull request');
    await demo.command('OpenChoreo: Generate Releases in Repository');
    const input = demo.page.locator('.quick-input-widget');
    await input.waitFor({ state: 'visible', timeout: 15_000 });
    await input.locator('input').fill('Project doclet');
    await demo.pause(800);
    await demo.page.keyboard.press('Enter');
    await demo.page.getByText(/releases generated/).first().waitFor({ timeout: 60_000 });
    await demo.pause(1500);
    await demo.screenshot('releases-generated');
    await demo.pause(800);
  },
};

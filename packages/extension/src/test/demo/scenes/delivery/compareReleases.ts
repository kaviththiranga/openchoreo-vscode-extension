// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import { restorePipeline } from './cluster';
import { PIPELINE } from './data';
import { closePanel, pickQuickItem, Sidebar } from './sidebar';

/** Before promoting: diff the release staging runs with what production runs. */
export const compareReleases: Scene = {
  name: 'compare-releases',
  title: 'Compare Releases: diff what staging runs with what production runs, before promoting',
  requires: ['cluster'],
  async setup(demo) {
    await restorePipeline();
    await closePanel(demo);
    const sb = new Sidebar(demo);
    await sb.showComponent(PIPELINE.project, PIPELINE.component, ['Release Bindings']);
  },
  async run(demo) {
    const sb = new Sidebar(demo);
    const staging = sb.row('staging', sb.node('Release Bindings', sb.node(PIPELINE.component)));
    await sb.menu(staging, 'Compare Releases…');
    // Production's release on the left, staging's on the right: what a promotion adds.
    await pickQuickItem(demo, /production/);
    const diff = demo.page.locator('.monaco-diff-editor').first();
    const added = diff.locator('.view-line', { hasText: 'RATE_LIMIT_PER_MINUTE' }).last();
    await added.waitFor({ timeout: 30_000 });
    await demo.pause(1500);
    await demo.mark('key', added);
    await demo.screenshot('release-diff');
    await demo.pause(1800);
  },
};

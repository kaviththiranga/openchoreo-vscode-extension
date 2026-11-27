// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import { namespaceChip, parkMouse, prepareSidebar, row, setExpanded, sidebar, waitForLoads } from './sidebar';

const TARGET = process.env.DEMO_EXPLORE_NAMESPACE ?? 'gitops-demo';
const TARGET_PROJECT = process.env.DEMO_EXPLORE_NAMESPACE_PROJECT ?? 'shop';

/**
 * Switch namespace from the sidebar's chip: the trees and the status bar
 * reload for the other team's projects. The switch writes the occ config, so
 * run it on a copy (OCC_CONFIG, see demo/seed/workspaces-explore.sh).
 */
export const switchNamespace: Scene = {
  name: 'switch-namespace',
  title: 'Switch namespace from the sidebar chip: projects and the status bar follow',
  requires: ['cluster'],
  async setup(demo) {
    const page = demo.page;
    await prepareSidebar(demo, TARGET);
    // Load the target namespace's tree once, then come back.
    const project = row(page, TARGET_PROJECT);
    await project.waitFor({ timeout: 60_000 });
    await prepareSidebar(demo, 'default', 'url-shortener');
    await setExpanded(demo, row(page, 'url-shortener'), true, false);
    await row(page, 'snip-frontend').waitFor({ timeout: 60_000 });
    await parkMouse(page);
  },
  async run(demo) {
    const page = demo.page;
    const chip = namespaceChip(page);
    await demo.pause(700);
    await demo.click(chip);
    const quick = page.locator('.quick-input-widget');
    await quick.waitFor({ state: 'visible', timeout: 15_000 });
    const item = quick.locator('.quick-input-list .monaco-list-row', { hasText: TARGET }).first();
    await item.waitFor({ timeout: 15_000 });
    await demo.pause(900);
    await demo.click(item);
    await chip.locator('.chip-text', { hasText: TARGET }).waitFor({ timeout: 30_000 });
    const project = row(page, TARGET_PROJECT);
    await project.waitFor({ timeout: 30_000 });
    await demo.pause(600);
    await setExpanded(demo, project, true);
    await sidebar(page).locator('.tree-children .tree-row .tree-chevron:not(.hidden)').first().waitFor({ timeout: 30_000 });
    await waitForLoads(page);
    await demo.pause(200);
    await demo.mark('key', sidebar(page).locator('.tree-section').first());
    const status = page.locator('.statusbar-item', { hasText: TARGET }).first();
    await demo.mark('status', status);
    await demo.pause(1600);
    await demo.screenshot('switched');
  },
};

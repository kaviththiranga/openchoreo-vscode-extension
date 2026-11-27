// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import { nextReleaseName, restorePipeline } from './cluster';
import { PIPELINE } from './data';
import { closePanel, Sidebar } from './sidebar';

let release = '';

/** Generate Release snapshots the component (type, traits, workload) as an immutable release. */
export const generateRelease: Scene = {
  name: 'generate-release',
  title: 'Generate Release: snapshot a component as an immutable, named release',
  requires: ['cluster'],
  async setup(demo) {
    await restorePipeline();
    release = await nextReleaseName();
    await closePanel(demo);
    const sb = new Sidebar(demo);
    await sb.showComponent(PIPELINE.project, PIPELINE.component, ['Releases', 'Release Bindings']);
  },
  async run(demo) {
    const page = demo.page;
    const { component } = PIPELINE;
    const sb = new Sidebar(demo);
    const comp = sb.node(component);

    await sb.menu(sb.row(component), 'Generate Release');
    const prompt = page.locator('.quick-input-widget');
    await prompt.waitFor({ state: 'visible' });
    await demo.pause(400);
    await demo.type(release, 40);
    await demo.pause(400);
    await page.keyboard.press('Enter');

    // The sidebar refreshes itself: the new release joins the list.
    const releaseRow = sb.row(release, sb.node('Releases', comp));
    await releaseRow.waitFor({ timeout: 30_000 });
    await demo.pause(900);
    await demo.mark('key', releaseRow);
    await demo.screenshot('generated');
    await demo.pause(1300);
  },
};

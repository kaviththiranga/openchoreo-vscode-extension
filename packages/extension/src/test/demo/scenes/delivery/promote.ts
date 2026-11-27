// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import { newestRelease, restorePipeline, setPipeline } from './cluster';
import { PIPELINE } from './data';
import { applyBinding, closePanel, Sidebar, waitForRelease } from './sidebar';

let release = '';

/** Promote: the next environment's binding opens pre-filled with the release, Mod+S promotes it. */
export const promote: Scene = {
  name: 'promote',
  title: 'Promote from the pipeline view: development → staging, reviewed as a pre-filled ReleaseBinding',
  requires: ['cluster'],
  async setup(demo) {
    const { component, v1, v2 } = PIPELINE;
    // development runs a newer release than staging.
    release = await newestRelease();
    await setPipeline({ development: release, staging: v2, production: v1 });
    await closePanel(demo);
    const sb = new Sidebar(demo);
    await sb.showComponent(PIPELINE.project, component, ['Release Bindings']);
  },
  async teardown() {
    await restorePipeline();
  },
  async run(demo) {
    const { component } = PIPELINE;
    const sb = new Sidebar(demo);
    const bindings = sb.node('Release Bindings', sb.node(component));

    await sb.menu(sb.row('development', bindings), 'Promote');
    await applyBinding(demo, release);
    const promoted = await waitForRelease(sb.row('staging', bindings), release);
    await demo.pause(700);
    await demo.mark('key', promoted);
    await demo.screenshot('promoted');
    await demo.pause(1300);
  },
};

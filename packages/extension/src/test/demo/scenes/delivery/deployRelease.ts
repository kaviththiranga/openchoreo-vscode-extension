// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import { newestRelease, restorePipeline } from './cluster';
import { PIPELINE } from './data';
import { applyBinding, closePanel, pickQuickItem, Sidebar, waitForRelease } from './sidebar';

let release = '';

/** Deploy to Environment: the binding opens pre-filled with the release and Mod+S deploys it. */
export const deployRelease: Scene = {
  name: 'deploy-release',
  title: 'Deploy to Environment: pick a release and an environment, review the binding, Mod+S deploys it',
  requires: ['cluster'],
  async setup(demo) {
    release = await newestRelease();
    await restorePipeline();
    await closePanel(demo);
    const sb = new Sidebar(demo);
    await sb.showComponent(PIPELINE.project, PIPELINE.component, ['Releases', 'Release Bindings']);
  },
  async teardown() {
    await restorePipeline();
  },
  async run(demo) {
    const sb = new Sidebar(demo);
    const comp = sb.node(PIPELINE.component);
    await sb.menu(sb.row(release, sb.node('Releases', comp)), 'Deploy to Environment…');
    await pickQuickItem(demo, /^development/);
    await applyBinding(demo, release);
    const deployed = await waitForRelease(sb.row('development', sb.node('Release Bindings', comp)), release);
    await demo.pause(700);
    await demo.mark('key', deployed);
    await demo.screenshot('deployed');
    await demo.pause(1300);
  },
};

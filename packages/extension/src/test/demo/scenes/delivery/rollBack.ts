// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import { restorePipeline } from './cluster';
import { PIPELINE } from './data';
import { applyBinding, closePanel, pickQuickItem, Sidebar, waitForRelease } from './sidebar';

/**
 * Roll development back: pick an earlier release, the binding opens for
 * review and Mod+S applies it. (OpenChoreo only binds a later environment to
 * a release the previous one references, so the first environment is the one
 * that rolls back to any release.)
 */
export const rollBack: Scene = {
  name: 'roll-back',
  title: 'Roll Back: bind an environment to an earlier release, reviewed in the editor before it applies',
  requires: ['cluster'],
  async setup(demo) {
    await restorePipeline();
    await closePanel(demo);
    const sb = new Sidebar(demo);
    await sb.showComponent(PIPELINE.project, PIPELINE.component, ['Release Bindings']);
  },
  async teardown() {
    await restorePipeline();
  },
  async run(demo) {
    const { component, v1 } = PIPELINE;
    const sb = new Sidebar(demo);
    const env = sb.row('development', sb.node('Release Bindings', sb.node(component)));
    await sb.menu(env, 'Roll Back…');
    await pickQuickItem(demo, v1);
    const line = demo.page.locator('.editor-group-container .monaco-editor .view-line', { hasText: `releaseName: ${v1}` }).first();
    await line.waitFor({ timeout: 30_000 });
    await demo.mark('review', line);
    await applyBinding(demo, v1);
    await waitForRelease(env, v1);
    await demo.pause(700);
    await demo.mark('key', env);
    await demo.screenshot('rolled-back');
    await demo.pause(1300);
  },
};

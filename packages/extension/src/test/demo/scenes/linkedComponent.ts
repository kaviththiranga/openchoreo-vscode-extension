// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../demo';

/**
 * The status bar knows which component the open source builds. Run with a
 * clone of a component's repository as the workspace, e.g.
 *   git clone https://github.com/openchoreo/sample-workloads /tmp/sample-workloads
 *   DEMO_WITH=cluster DEMO_WORKSPACE=/tmp/sample-workloads DEMO_SCENES=linked-component pnpm demo:capture
 */
export const linkedComponent: Scene = {
  name: 'linked-component',
  title: 'Source linked to its OpenChoreo component: build this commit, logs, shell and local runs from the status bar',
  requires: ['cluster'],
  async run(demo) {
    await demo.caption('Open your code: the extension knows which component it builds');
    await demo.page.locator('[id="openchoreo.linkedComponent"]').first().waitFor({ timeout: 30_000 });
    await demo.pause(1200);
    await demo.screenshot('status-bar');
    await demo.command('OpenChoreo: Linked Component Actions');
    await demo.pause(1500);
    await demo.screenshot('actions');
    await demo.page.keyboard.press('Escape');
    await demo.pause(600);
  },
};

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../demo';

const seconds = Number(process.env.DEMO_MANUAL_SECONDS ?? 0);

/**
 * Records whatever you do in the window for DEMO_MANUAL_SECONDS, for footage
 * no script covers yet (troubleshooting a real failed build, a chat session).
 * Needs a visible window: run it on a machine with a display.
 */
export const manual: Scene = {
  name: 'manual',
  title: `Free recording of ${seconds}s of manual interaction`,
  requires: ['manual'],
  async run(demo) {
    console.log(`  recording for ${seconds}s — use the VS Code window now`);
    await demo.pause(seconds * 1000);
    await demo.screenshot('end');
  },
};

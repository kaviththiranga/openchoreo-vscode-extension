// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../demo';

/** The "Fix with Copilot" quick fix on an OpenChoreo validation problem. */
export const fixWithCopilot: Scene = {
  name: 'fix-with-copilot',
  title: 'A validation problem offers "Fix with Copilot" in the quick-fix menu',
  async run(demo) {
    await demo.openFile('workload-typo.yaml');
    await demo.pause(1500);
    await demo.caption('One click from a problem to a fix');
    await demo.goTo(12, 5);
    await demo.press('Control+.');
    await demo.page.locator('.action-widget').getByText('Fix with Copilot').first().waitFor({ timeout: 15_000 });
    await demo.pause(1500);
    await demo.screenshot('quick-fix');
    await demo.page.keyboard.press('Escape');
    await demo.pause(600);
  },
};

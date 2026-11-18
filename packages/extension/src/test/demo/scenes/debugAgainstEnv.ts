// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../demo';

/**
 * F5 against a real environment: tunnels open, the debugger gets the bindings.
 * Run with the debug fixture as the workspace (greeter-service in namespace default):
 *   DEMO_WITH=cluster DEMO_WORKSPACE=test-fixtures/debug-workspace DEMO_SCENES=debug-against-env pnpm demo:capture
 */
export const debugAgainstEnv: Scene = {
  name: 'debug-against-env',
  title: 'Debug Against Environment: run your code locally with tunnels to the environment\'s dependencies',
  requires: ['cluster'],
  async run(demo) {
    await demo.openFile('app.js');
    await demo.caption('Debug locally against a real environment');
    await demo.command('OpenChoreo: Debug Against Environment');
    // Environment pick (skipped when there is only one), then the launch configuration (one in the fixture).
    const input = demo.page.locator('.quick-input-widget');
    const asked = await input.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
    if (asked) {
      await demo.pause(800);
      await input.locator('input').fill('development');
      await demo.pause(600);
      await demo.page.keyboard.press('Enter');
    }
    // The program's output in the Debug Console, not the same words in app.js.
    await demo.page.locator('.repl').getByText('Environment from OpenChoreo').first().waitFor({ timeout: 90_000 });
    await demo.pause(1500);
    await demo.screenshot('debug-console');
    await demo.page.locator('[id="openchoreo.tunnels"]').first().waitFor({ timeout: 10_000 }).catch(() => undefined);
    await demo.pause(1500);
  },
};

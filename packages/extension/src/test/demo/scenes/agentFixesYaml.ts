// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../demo';

/**
 * Copilot finds and fixes a mistake in OpenChoreo YAML with the validation
 * tool. Needs a signed-in Copilot (DEMO_WITH=copilot with a real profile).
 */
export const agentFixesYaml: Scene = {
  name: 'agent-fixes-yaml',
  title: 'Copilot validates a Workload with the OpenChoreo tool and fixes the misspelled field',
  requires: ['copilot'],
  async run(demo) {
    await demo.openFile('workload-typo.yaml');
    await demo.caption('Ask the agent to check your YAML');
    await demo.command('Chat: Open Chat');
    await demo.pause(1200);
    await demo.type('#openchoreoValidate workload-typo.yaml and fix every problem it reports', 40);
    await demo.pause(600);
    await demo.page.keyboard.press('Enter');
    // Wait for the response to finish: the request's stop button goes away.
    await demo.page.locator('.interactive-response').last().waitFor({ timeout: 60_000 });
    await demo.page.locator('.chat-execute-toolbar .codicon-stop-circle, .codicon-debug-stop')
      .first().waitFor({ state: 'detached', timeout: 180_000 }).catch(() => {});
    await demo.pause(2000);
    await demo.screenshot('agent-response');
  },
};

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * The answering halves of the chat hand-offs: the agent troubleshoots the
 * failed build and fixes the YAML. They need a signed-in Copilot (or another
 * chat model), so they run only with DEMO_WITH=copilot (see index.ts).
 */
import type { Demo, Scene } from '../../demo';
import { prepareChat, showFailedRun, troubleshootFailedRun } from './chatHandoffs';
import { openTypo, showQuickFix, TYPO } from './fixWithCopilot';
import { chatInput, closeChat, closePanel, freshChat } from './helpers';

/** Troubleshoot with Copilot on the failed build, sent: the agent reads the run's logs and explains the cause. */
export const agentTroubleshootsBuild: Scene = {
  name: 'agent-troubleshoots-build',
  title: 'The agent reads the failed build through the OpenChoreo MCP server and explains the cause',
  requires: ['cluster', 'copilot'],
  async setup(demo) {
    await showFailedRun(demo);
    await prepareChat(demo);
  },
  async run(demo) {
    await troubleshootFailedRun(demo);
    await demo.pause(900);
    await demo.press('Enter');
    await waitForAnswer(demo);
    await demo.pause(1500);
    await demo.mark('key', lastResponse(demo));
    await demo.screenshot('answer');
    await demo.pause(1500);
  },
};

/** Fix with Copilot from the quick-fix menu: the prompt and the file go to the agent, which corrects the field. */
export const agentFixesYaml: Scene = {
  name: 'agent-fixes-yaml',
  title: 'Fix with Copilot: the agent corrects the misspelled field in the Workload',
  requires: ['copilot'],
  async setup(demo) {
    await closePanel(demo);
    await demo.command('View: Close All Editors');
    // An empty chat for the hand-off, closed until the quick fix opens it.
    await freshChat(demo);
    await closeChat(demo);
    await openTypo(demo);
  },
  async run(demo) {
    const page = demo.page;
    await showQuickFix(demo);
    await demo.pause(700);
    await demo.click(page.locator('.action-widget').getByText('Fix with Copilot').first());
    await waitForAnswer(demo);
    // The edit lands in the editor: the misspelled field is gone.
    await page.locator('.monaco-editor .view-lines', { hasText: TYPO.field }).first()
      .waitFor({ state: 'detached', timeout: 60_000 }).catch(() => {});
    await demo.pause(1500);
    await demo.mark('key', lastResponse(demo));
    await demo.screenshot('fixed');
    await demo.pause(1500);
  },
};

function lastResponse(demo: Demo) {
  return demo.page.locator('.part.auxiliarybar .interactive-response').last();
}

/**
 * Wait for the agent to finish, approving the tool calls it asks to run (the
 * OpenChoreo MCP tools and file edits ask the first time).
 */
async function waitForAnswer(demo: Demo, timeoutMs = 240_000): Promise<void> {
  const page = demo.page;
  const chat = page.locator('.part.auxiliarybar');
  await chat.locator('.interactive-response').first().waitFor({ timeout: 60_000 });
  const allow = chat.getByRole('button', { name: /^(Allow|Continue|Keep)\b/ }).first();
  const busy = chatInput(page).locator('.codicon-stop-circle, .codicon-debug-stop, [aria-label^="Cancel"], [aria-label^="Stop"]').first();
  const deadline = Date.now() + timeoutMs;
  let idleSince: number | undefined;
  while (Date.now() < deadline) {
    if (await allow.isVisible().catch(() => false)) {
      await demo.click(allow);
      idleSince = undefined;
    } else if (await busy.isVisible().catch(() => false)) {
      idleSince = undefined;
    } else {
      idleSince ??= Date.now();
      if (Date.now() - idleSince > 2500) return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error('the agent did not finish in time');
}

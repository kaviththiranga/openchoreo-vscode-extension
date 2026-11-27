// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Locator } from 'playwright-core';
import type { Demo, Scene } from '../../demo';
import {
  chatInput, childRow, closePanel, collapse, contextMenu, expand, freshChat, row, showOpenChoreo, sidebar, widenChat,
  widenSidebar,
} from './helpers';

/** The failed build seeded on the demo cluster (samples/mcp/build-failures: a wrong Dockerfile path). */
const FAILED_RUN = { project: 'default', component: 'greeting-service', run: 'greeting-service-build-02' };

/** The component whose YAML goes to chat. */
const COMPONENT = { project: 'url-shortener', component: 'snip-api-service' };

/**
 * Right-click a component, Add YAML to Chat: the live resource is attached to
 * the chat input with a prompt naming it, ready for a question.
 */
export const chatAddYaml: Scene = {
  name: 'chat-add-yaml',
  title: 'Add YAML to Chat attaches a live OpenChoreo resource to the chat input',
  requires: ['cluster'],
  async setup(demo) {
    await prepareSidebar(demo, COMPONENT.project);
    await row(demo.page, COMPONENT.component).waitFor({ timeout: 30_000 });
    await prepareChat(demo);
  },
  async run(demo) {
    const target = row(demo.page, COMPONENT.component);
    await demo.pause(600);
    const item = await contextMenu(demo, target, 'Add YAML to Chat');
    await demo.pause(900);
    await demo.click(item);
    const attachment = chatInput(demo.page).locator('.chat-attached-context-attachment, .chat-attached-context .monaco-icon-label')
      .filter({ hasText: COMPONENT.component }).first();
    await attachment.waitFor({ timeout: 30_000 });
    await promptText(demo, /Regarding\sthe\sattached\sOpenChoreo\sComponent/);
    await demo.pause(900);
    await demo.mark('key', chatInput(demo.page));
    await demo.type('what does it depend on, and on which port does it listen?', 45);
    await demo.pause(1600);
    await demo.screenshot('attached');
  },
};

/**
 * Right-click a failed build, Troubleshoot with Copilot: the chat input gets a
 * prompt that names the run and asks the agent to find the cause with the
 * OpenChoreo tools.
 */
export const troubleshootBuild: Scene = {
  name: 'troubleshoot-build',
  title: 'Troubleshoot with Copilot on a failed build hands the run to chat',
  requires: ['cluster'],
  async setup(demo) {
    await showFailedRun(demo);
    await prepareChat(demo);
  },
  async run(demo) {
    await troubleshootFailedRun(demo);
    await demo.pause(1800);
    await demo.screenshot('prompt');
  },
};

/** Open the failed run's row in the sidebar (off camera). */
export async function showFailedRun(demo: Demo): Promise<Locator> {
  const page = demo.page;
  await prepareSidebar(demo, FAILED_RUN.project);
  const component = row(page, FAILED_RUN.component);
  await expand(page, component);
  await expand(page, childRow(page, component, /^Workflow Runs/));
  const run = row(page, FAILED_RUN.run);
  await run.waitFor({ timeout: 30_000 });
  // The context menu offers Troubleshoot once the run's outcome is in.
  await run.locator('.tree-description', { hasText: /Failed|Error/ }).waitFor({ timeout: 30_000 });
  return run;
}

/** On camera: right-click the failed run, Troubleshoot with Copilot, and wait for the prompt in chat. */
export async function troubleshootFailedRun(demo: Demo): Promise<void> {
  const run = row(demo.page, FAILED_RUN.run);
  await demo.pause(600);
  const item = await contextMenu(demo, run, 'Troubleshoot with Copilot');
  await demo.pause(900);
  await demo.click(item);
  await promptText(demo, new RegExp(`Why\\sdid\\sworkflow\\srun\\s.?${FAILED_RUN.run}`));
  await demo.pause(600);
  await demo.mark('key', chatInput(demo.page));
}

/** The OpenChoreo view, wide enough for run names, with only `project` open (off camera). */
async function prepareSidebar(demo: Demo, project: string): Promise<void> {
  const page = demo.page;
  await closePanel(demo);
  await showOpenChoreo(page);
  await widenSidebar(page, 470);
  const projects = sidebar(page).locator('.section-body').first()
    .locator(':scope > .tree-node > .tree-row');
  await projects.first().waitFor({ timeout: 60_000 });
  for (let i = 0; i < (await projects.count()); i++) await collapse(projects.nth(i));
  await expand(page, row(page, project));
}

/** A fresh, wide chat next to the sidebar (off camera). */
export async function prepareChat(demo: Demo): Promise<void> {
  await demo.command('View: Close All Editors');
  await freshChat(demo);
  await widenChat(demo.page, 640);
  await demo.pause(400);
  // Leave the keyboard focus out of the chat so the hand-off is what fills it.
  await sidebar(demo.page).locator('.tree-row').first().hover();
}

/** Wait until the chat input holds the hand-off prompt (the editor renders spaces as non-breaking: match them with \s). */
async function promptText(demo: Demo, text: RegExp): Promise<void> {
  await chatInput(demo.page).locator('.view-lines', { hasText: text }).first().waitFor({ timeout: 30_000 });
}

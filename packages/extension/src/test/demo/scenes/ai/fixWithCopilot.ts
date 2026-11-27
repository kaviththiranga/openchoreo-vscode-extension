// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Demo, Scene } from '../../demo';
import { closeChat, closePanel, widenSidebar } from './helpers';

/** The file with the misspelled field (demo/seed/workspaces-ai.sh) and where the typo is. */
export const TYPO = { file: '.openchoreo/workload.yaml', line: 32, column: 9, field: 'visibilty' };

/** A validation problem offers "Fix with Copilot" in the quick-fix menu. */
export const fixWithCopilot: Scene = {
  name: 'fix-with-copilot',
  title: 'A validation problem offers "Fix with Copilot" in the quick-fix menu',
  requires: ['workspace'],
  async setup(demo) {
    await closeChat(demo);
    await closePanel(demo);
    await openTypo(demo);
  },
  async run(demo) {
    await showQuickFix(demo);
    await demo.pause(1800);
    await demo.screenshot('quick-fix');
  },
};

/** Open the file with the typo, its problems shown, cursor at the top (off camera). */
export async function openTypo(demo: Demo): Promise<void> {
  const page = demo.page;
  await demo.command('View: Show Explorer');
  await widenSidebar(page, 330);
  await demo.openFile(TYPO.file);
  // The problem's squiggle shows once the language server has validated the file
  // (and only for lines in view).
  await demo.goTo(TYPO.line, 1);
  await page.locator('.monaco-editor .squiggly-error, .monaco-editor .squiggly-warning').first().waitFor({ timeout: 60_000 });
  await demo.goTo(TYPO.line - 8, 1);
  await demo.pause(500);
}

/** On camera: go to the misspelled field, show its problem, and open the quick-fix menu on it. */
export async function showQuickFix(demo: Demo): Promise<void> {
  const page = demo.page;
  await demo.pause(700);
  await demo.goTo(TYPO.line, TYPO.column);
  await demo.pause(600);
  // The problem itself first: Show Hover at the cursor.
  await demo.press('Mod+K');
  await demo.press('Mod+I');
  const hover = page.locator('.monaco-hover', { hasText: TYPO.field }).first();
  await hover.waitFor({ timeout: 15_000 });
  await demo.pause(400);
  await demo.mark('problem', hover);
  await demo.pause(1600);
  await page.keyboard.press('Escape');
  await demo.pause(500);
  await demo.press('Mod+.');
  const item = page.locator('.action-widget').getByText('Fix with Copilot').first();
  await item.waitFor({ timeout: 15_000 });
  await demo.pause(500);
  await demo.mark('key', page.locator('.action-widget').first());
}

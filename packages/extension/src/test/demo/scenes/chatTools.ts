// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../demo';

/**
 * The OpenChoreo tools and MCP servers in the chat tools picker. The chat
 * input only shows its tools button once Copilot is signed in.
 */
export const chatTools: Scene = {
  name: 'chat-tools',
  title: 'OpenChoreo editor tools and MCP servers in the chat tools picker',
  requires: ['copilot'],
  async run(demo) {
    await demo.caption('Validation, session context and scaffolds as chat tools');
    await demo.command('Chat: Open Chat');
    await demo.pause(2000);
    const configure = demo.page.locator('.interactive-input-part [aria-label*="Tools"]').first();
    await demo.click(configure);
    await demo.page.locator('.quick-input-widget').getByText('Validate OpenChoreo YAML').first()
      .waitFor({ timeout: 20_000 });
    await demo.type('openchoreo', 70);
    await demo.pause(1800);
    await demo.screenshot('tools-picker');
    await demo.page.keyboard.press('Escape');
    await demo.pause(600);
  },
};

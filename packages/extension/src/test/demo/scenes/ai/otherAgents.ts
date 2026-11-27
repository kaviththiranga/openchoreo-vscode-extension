// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import { closeChat, closePanel } from './helpers';

/** The setup page for using the same MCP servers and skills from other agents. */
export const otherAgents: Scene = {
  name: 'other-agents',
  title: 'The same OpenChoreo MCP servers and skills, with ready-to-run Claude Code commands',
  requires: ['cluster'],
  async setup(demo) {
    await closeChat(demo);
    await closePanel(demo);
    // A full-width page: the side bar adds nothing here.
    if (await demo.page.locator('.part.sidebar').first().isVisible().catch(() => false)) {
      await demo.command('View: Close Primary Side Bar');
      await demo.pause(400);
    }
    // Warm up the Markdown preview (its first start is slow), then close it.
    await demo.command('OpenChoreo: Use with Other AI Agents');
    await demo.page.frameLocator('iframe.webview').first().frameLocator('iframe').first()
      .locator('table').first().waitFor({ timeout: 60_000 });
    await demo.command('View: Close All Editors');
    await demo.pause(600);
  },
  async run(demo) {
    const page = demo.page;
    await demo.command('OpenChoreo: Use with Other AI Agents');
    const preview = page.frameLocator('iframe.webview').first().frameLocator('iframe').first();
    const table = preview.locator('table').first();
    await table.waitFor({ timeout: 30_000 });
    await demo.pause(1800);
    await demo.mark('servers', table);

    const commands = preview.locator('pre', { hasText: 'claude mcp add' }).first();
    await commands.waitFor({ timeout: 10_000 });
    await demo.pause(1500);
    await demo.mark('key', commands);
    await demo.screenshot('guide');
    await demo.pause(1500);
  },
};

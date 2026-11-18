// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../demo';

/** Setup commands for using the same MCP servers and skills from other agents. */
export const otherAgents: Scene = {
  name: 'other-agents',
  title: 'The same OpenChoreo MCP servers and skills, ready for Claude Code and other agents',
  requires: ['cluster'],
  async run(demo) {
    await demo.caption('Take the same tools to any agent');
    await demo.command('OpenChoreo: Use with Other AI Agents');
    await demo.page.frameLocator('iframe.webview').first().frameLocator('iframe').first()
      .getByText('Claude Code').first().waitFor({ timeout: 30_000 });
    await demo.pause(1500);
    await demo.screenshot('guide');
    await demo.pause(800);
  },
};

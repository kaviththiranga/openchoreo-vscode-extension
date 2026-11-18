// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../demo';

/** The MCP servers the extension registers from the occ session. */
export const mcpServers: Scene = {
  name: 'mcp-servers',
  title: 'OpenChoreo MCP servers registered automatically from the occ login',
  requires: ['cluster'],
  async run(demo) {
    await demo.caption('Control plane and observability MCP servers, no setup');
    await demo.command('MCP: List Servers');
    await demo.page.locator('.quick-input-list').getByText('openchoreo-cp').first()
      .waitFor({ timeout: 20_000 });
    await demo.pause(1500);
    await demo.screenshot('server-list');
    await demo.page.keyboard.press('Escape');
    await demo.pause(600);
  },
};

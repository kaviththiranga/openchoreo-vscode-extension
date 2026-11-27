// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Locator } from 'playwright-core';
import type { Demo, Scene } from '../../demo';
import { closeChat, closePanel, setPanelHeight } from './helpers';

const SERVER = 'openchoreo-cp';

/**
 * The MCP servers the extension registers from the occ login (control plane,
 * platform engineer with openchoreo.mcp.platformEngineerTools, observability),
 * started from MCP: List Servers: the control plane's tools come up with no
 * configuration.
 */
export const mcpServers: Scene = {
  name: 'mcp-servers',
  title: 'OpenChoreo MCP servers registered automatically from the occ login, started in one click',
  requires: ['cluster'],
  async setup(demo) {
    await closeChat(demo);
    // An output panel tall enough to read, remembered for when the scene opens it.
    await demo.command('Output: Focus on Output View');
    await demo.page.locator('.part.panel').first().waitFor({ timeout: 10_000 });
    await setPanelHeight(demo.page, 300);
    await closePanel(demo);
    // Start from a stopped server, so the scene can start it.
    await demo.command('MCP: List Servers');
    const server = serverRow(demo, SERVER);
    await server.waitFor({ timeout: 30_000 });
    if (/Running|Starting/.test(await server.innerText())) {
      await server.click();
      await actionRow(demo, /^Stop Server/).click();
      await demo.pause(1500);
    } else {
      await demo.page.keyboard.press('Escape');
    }
  },
  async run(demo) {
    const page = demo.page;
    await demo.command('MCP: List Servers');
    const server = serverRow(demo, SERVER);
    await serverRow(demo, 'openchoreo-obs').waitFor({ timeout: 30_000 });
    await demo.pause(1400);
    await demo.mark('servers', page.locator('.quick-input-widget').first());
    await demo.screenshot('servers');
    await demo.click(server);
    const start = actionRow(demo, /^Start Server/);
    await start.waitFor({ timeout: 10_000 });
    await demo.pause(700);
    await demo.click(start);
    await demo.pause(1200);

    await demo.command('MCP: List Servers');
    await server.filter({ hasText: 'Running' }).waitFor({ timeout: 30_000 });
    await demo.pause(900);
    await demo.mark('running', page.locator('.quick-input-widget').first());
    await demo.click(server);
    const output = actionRow(demo, /^Show Output/);
    await output.waitFor({ timeout: 10_000 });
    await demo.pause(500);
    await demo.click(output);
    const tools = page.locator('.part.panel .view-line', { hasText: /Discovered\s\d+\stools/ }).first();
    await tools.waitFor({ timeout: 30_000 });
    await demo.pause(800);
    await demo.mark('key', tools);
    await demo.screenshot('tools');
    await demo.pause(1200);
  },
};

function serverRow(demo: Demo, name: string): Locator {
  return demo.page.locator('.quick-input-list .monaco-list-row', { hasText: new RegExp(`^${name}`) }).first();
}

function actionRow(demo: Demo, label: RegExp): Locator {
  return demo.page.locator('.quick-input-list .monaco-list-row').filter({ hasText: label }).first();
}

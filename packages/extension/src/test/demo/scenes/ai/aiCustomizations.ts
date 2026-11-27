// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Locator } from 'playwright-core';
import type { Demo, Scene } from '../../demo';
import { closeChat, closePanel } from './helpers';

/**
 * The official OpenChoreo skills, the Developer and Platform Engineer agents,
 * the YAML instructions and the MCP servers in Chat: Open Customizations.
 * The Platform Engineer agent shows with openchoreo.mcp.platformEngineerTools.
 */
export const aiCustomizations: Scene = {
  name: 'ai-customizations',
  title: 'OpenChoreo skills, custom agents, instructions and MCP servers in the Customizations editor',
  requires: ['workspace'],
  async setup(demo) {
    await closeChat(demo);
    await closePanel(demo);
    // Land on Skills, not the Browse page (marketplace and a sign-in prompt):
    // the editor reopens on the section it last showed.
    await demo.command('Chat: Open Customizations');
    await nav(demo, 'Skills').waitFor({ timeout: 30_000 });
    await nav(demo, 'Skills').click();
    await heading(demo, 'Skills').waitFor({ timeout: 15_000 });
    await demo.page.keyboard.press('Escape');
    await demo.pause(600);
  },
  async run(demo) {
    const page = demo.page;
    // Recently used after setup, so the short query finds it first.
    await demo.command('Open Customizations');
    await nav(demo, 'Skills').waitFor({ timeout: 30_000 });
    if (!(await heading(demo, 'Skills').isVisible().catch(() => false))) await demo.click(nav(demo, 'Skills'));
    const search = page.getByPlaceholder('Search skills...');
    await search.waitFor({ timeout: 15_000 });
    await demo.pause(900);
    await demo.click(search);
    await demo.type('openchoreo', 55);
    const skill = page.getByText('openchoreo-platform-engineer-gitops', { exact: true }).first();
    await skill.waitFor({ timeout: 15_000 });
    await demo.pause(1500);
    await demo.mark('key', panel(demo));
    await demo.screenshot('skills');

    await demo.click(nav(demo, 'Agents'));
    await page.getByText('OpenChoreo Platform Engineer', { exact: true }).first().waitFor({ timeout: 15_000 });
    await demo.pause(1300);
    await demo.mark('agents', panel(demo));
    await demo.screenshot('agents');

    await demo.click(nav(demo, 'Instructions'));
    await page.getByText('OpenChoreo Resources').first().waitFor({ timeout: 15_000 });
    await demo.pause(1000);
    await demo.mark('instructions', panel(demo));
    await demo.screenshot('instructions');

    await demo.click(nav(demo, 'MCP Servers'));
    await page.getByText('openchoreo-obs', { exact: true }).first().waitFor({ timeout: 15_000 });
    await demo.pause(1600);
    await demo.mark('mcp-servers', panel(demo));
    await demo.screenshot('mcp-servers');
  },
};

/** A section in the editor's navigation (it comes before the page, so its label is the first match). */
function nav(demo: Demo, label: string): Locator {
  return demo.page.getByText(label, { exact: true }).first();
}

function heading(demo: Demo, label: string): Locator {
  return demo.page.getByRole('heading', { name: label, exact: true }).first();
}

/** The section's content, for zooms. */
function panel(demo: Demo): Locator {
  return demo.page.getByRole('heading').filter({ hasText: /^(Skills|Agents|Instructions|MCP Servers)$/ }).first()
    .locator('xpath=ancestor::*[.//input][1]');
}

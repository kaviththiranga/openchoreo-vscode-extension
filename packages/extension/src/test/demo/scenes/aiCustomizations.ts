// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../demo';

/** The OpenChoreo skills, agents and instructions in VS Code's Customizations editor. */
export const aiCustomizations: Scene = {
  name: 'ai-customizations',
  title: 'OpenChoreo skills, custom agents, instructions and MCP servers in the Customizations editor',
  async run(demo) {
    await demo.caption('Official OpenChoreo skills ship with the extension');
    await demo.command('Chat: Open Customizations');
    // The navigation comes before the page content, so its label is the first match.
    const nav = (label: string) => demo.page.getByText(label, { exact: true }).first();
    await nav('Skills').waitFor({ timeout: 20_000 });
    await demo.pause(800);

    await demo.click(nav('Skills'));
    await demo.page.getByText('openchoreo-developer', { exact: true }).first().waitFor({ timeout: 20_000 });
    await demo.pause(1500);
    await demo.screenshot('skills');

    await demo.caption('Developer and platform-engineer agents');
    await demo.click(nav('Agents'));
    await demo.page.getByText('OpenChoreo Developer').first().waitFor({ timeout: 20_000 });
    await demo.pause(1500);
    await demo.screenshot('agents');

    await demo.click(nav('Instructions'));
    await demo.page.getByText('OpenChoreo resources').first().waitFor({ timeout: 20_000 });
    await demo.pause(1500);
    await demo.screenshot('instructions');

    await demo.page.keyboard.press('Escape');
    await demo.pause(600);
  },
};

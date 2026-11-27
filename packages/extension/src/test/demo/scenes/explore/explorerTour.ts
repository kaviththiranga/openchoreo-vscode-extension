// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Locator } from 'playwright-core';
import type { Scene } from '../../demo';
import { childRow, hover, prepareSidebar, row, section, setExpanded } from './sidebar';

const PROJECT = 'url-shortener';
const COMPONENT = 'snip-frontend';

/**
 * The OpenChoreo activity bar view: a project's components, one component's
 * deployment pipeline (development, staging, production with their
 * releases), the namespace's and cluster's platform resources, and the
 * status bar connection with the server and occ versions.
 */
export const explorerTour: Scene = {
  name: 'explorer-tour',
  title: 'The OpenChoreo sidebar: projects, a component deployed across three environments, platform resources and the connection',
  requires: ['cluster'],
  async setup(demo) {
    const page = demo.page;
    await prepareSidebar(demo);
    // Load every level once, so nothing spins on camera, then fold it all again.
    const project = row(page, PROJECT);
    await project.waitFor({ timeout: 60_000 });
    await setExpanded(demo, project, true, false);
    const component = childRow(page, project, COMPONENT);
    await component.waitFor({ timeout: 60_000 });
    await setExpanded(demo, component, true, false);
    const bindings = childRow(page, component, 'Release Bindings');
    await bindings.waitFor({ timeout: 60_000 });
    await setExpanded(demo, bindings, true, false);
    await childRow(page, bindings, 'production').waitFor({ timeout: 60_000 });
    await section(page, 'Namespace Resources').click();
    const environments = row(page, 'Environments');
    await environments.waitFor({ timeout: 60_000 });
    await setExpanded(demo, environments, true, false);
    await childRow(page, environments, 'production').waitFor({ timeout: 60_000 });
    await section(page, 'Cluster Resources').click();
    const types = row(page, 'Cluster Component Types');
    await types.waitFor({ timeout: 60_000 });
    await setExpanded(demo, types, true, false);
    await childRow(page, types, 'service').waitFor({ timeout: 60_000 });
    // The connection tooltip lists the occ version only when `occ version` answered in time (it can time out on a loaded host).
    await page.locator('.statusbar-item .codicon[class*="openchoreo-logo"]').first().hover();
    const tip = await page.locator('.workbench-hover', { hasText: 'Server: OpenChoreo' }).first().textContent({ timeout: 15_000 }).catch(() => '');
    if (!tip?.includes('CLI:')) console.warn('  explorer-tour: the connection tooltip has no occ (CLI) line this run');
    await prepareSidebar(demo, 'default', PROJECT);
  },
  async run(demo) {
    const page = demo.page;
    const children = (parent: Locator) => parent.locator('xpath=../div[contains(@class,"tree-children")]');

    const project = row(page, PROJECT);
    await demo.pause(300);
    await demo.click(project.locator('.tree-chevron'));
    const component = childRow(page, project, COMPONENT);
    await component.waitFor({ timeout: 30_000 });
    await demo.pause(500);
    await demo.click(component.locator('.tree-chevron'));
    const bindings = childRow(page, component, 'Release Bindings');
    await bindings.waitFor({ timeout: 30_000 });
    await demo.pause(300);
    await demo.click(bindings.locator('.tree-chevron'));
    await childRow(page, bindings, 'production').waitFor({ timeout: 30_000 });
    await demo.pause(300);
    await demo.mark('key', children(bindings));
    await demo.screenshot('pipeline');
    await demo.pause(900);

    // Fold the project away and open the platform resources.
    await demo.click(project.locator('.tree-chevron'));
    await demo.pause(300);
    await demo.click(section(page, 'Namespace Resources'));
    await row(page, 'Environments').waitFor({ timeout: 30_000 });
    await demo.pause(600);
    await demo.click(section(page, 'Cluster Resources'));
    const types = row(page, 'Cluster Component Types');
    await types.waitFor({ timeout: 30_000 });
    await demo.pause(300);
    await demo.click(types.locator('.tree-chevron'));
    await childRow(page, types, 'service').waitFor({ timeout: 30_000 });
    await demo.pause(600);
    await demo.screenshot('platform-resources');

    // The connection: context, namespace, control plane and versions.
    await hover(demo, page.locator('.statusbar-item .codicon[class*="openchoreo-logo"]').first());
    const tooltip = page.locator('.workbench-hover', { hasText: 'Server: OpenChoreo' }).first();
    await tooltip.waitFor({ timeout: 15_000 });
    await demo.mark('result', tooltip);
    await demo.screenshot('connection');
    await demo.pause(900);
  },
};

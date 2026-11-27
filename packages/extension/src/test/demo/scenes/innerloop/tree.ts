// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Locator } from 'playwright-core';
import type { Demo } from '../../demo';
import { collapse, expand, showOpenChoreo, sidebar, treeNode, widenSidebar } from './helpers';

/**
 * Off camera: open the OpenChoreo view with only `project` expanded and,
 * with `bindings`, the component's Release Bindings open.
 */
export async function revealComponent(demo: Demo, project: string, component: string, options: { bindings?: boolean } = {}): Promise<void> {
  const page = demo.page;
  await showOpenChoreo(page);
  await widenSidebar(page, 520);
  await sidebar(page).locator('.tree-node').first().waitFor({ timeout: 60_000 });
  const projectNode = treeNode(page, project);
  await projectNode.waitFor({ timeout: 60_000 });
  // Other projects folded, so the component sits near the top.
  await foldSiblings(projectNode);
  await expand(projectNode);
  const componentNode = treeNode(page, component, projectNode);
  for (const sibling of await projectNode.locator(':scope > .tree-children > .tree-node').all()) {
    if ((await sibling.locator(':scope > .tree-row .tree-label').textContent())?.trim() !== component) await collapse(sibling);
  }
  if (options.bindings) {
    await expand(componentNode);
    for (const child of await componentNode.locator(':scope > .tree-children > .tree-node').all()) {
      const label = (await child.locator(':scope > .tree-row .tree-label').textContent())?.trim();
      if (label === 'Release Bindings') await expand(child);
      else await collapse(child);
    }
  } else {
    await collapse(componentNode);
  }
  await demo.pause(800);
}

/** Collapse every other node at the same level as `node`. */
async function foldSiblings(node: Locator): Promise<void> {
  const parent = node.locator('xpath=..');
  const label = (await node.locator(':scope > .tree-row .tree-label').textContent())?.trim();
  for (const sibling of await parent.locator(':scope > .tree-node').all()) {
    if ((await sibling.locator(':scope > .tree-row .tree-label').textContent())?.trim() !== label) await collapse(sibling);
  }
}

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Locator, Page } from 'playwright-core';
import type { Scene } from '../../demo';
import { activeTab, editorAction, expandSidebarRows, hideCursor, hold, menuItem, openContextMenu, parkMouse, showFiles, showOpenChoreo, sidebarFrame, sidebarRow } from './ui';
import { AUTOSCALER, resetWorkspace } from './workspace';

/** The diff's repository side, from the first line greeter's work in progress adds. */
async function addedTrait(page: Page): Promise<Locator> {
  const diff = page.locator('.monaco-diff-editor').first();
  await diff.waitFor({ timeout: 30_000 });
  const traits = diff.locator('.editor.modified .view-line', { hasText: /^\s*traits:/ }).first();
  await traits.waitFor({ timeout: 30_000 });
  return diff.locator('.editor.modified').first();
}

/**
 * Compare with Cluster from the editor title of a repository file: the cluster
 * side leaves out status and server-set metadata and follows the file's key
 * order, so only greeter's new autoscaler shows.
 */
export const compareWithCluster: Scene = {
  name: 'compare-with-cluster',
  title: 'Compare with Cluster: a GitOps repository file next to what the cluster runs, only the real difference',
  requires: ['cluster', 'gitops-workspace'],
  teardown: async () => resetWorkspace(),
  async setup(demo) {
    resetWorkspace(AUTOSCALER);
    await showFiles(demo, 330);
    await demo.openFile('greeter/component.yaml');
    await activeTab(demo.page, 'component.yaml');
    await parkMouse(demo.page);
  },
  async run(demo) {
    const page = demo.page;
    await demo.pause(1400);
    await demo.click(editorAction(page, 'Compare with Cluster'));
    const modified = await addedTrait(page);
    await hideCursor(demo);
    await demo.mark('key', modified);
    await hold(demo, 'compare-with-cluster', 3000);
  },
};

/** Compare with Repository from a sidebar resource: what the cluster runs next to the file that declares it. */
export const compareWithRepository: Scene = {
  name: 'compare-with-repository',
  title: 'Compare with Repository: a cluster resource from the sidebar next to the GitOps file that declares it',
  requires: ['cluster', 'gitops-workspace'],
  teardown: async () => resetWorkspace(),
  async setup(demo) {
    resetWorkspace(AUTOSCALER);
    const frame = await showOpenChoreo(demo, 330);
    await expandSidebarRows(frame, ['shop']);
    await sidebarRow(frame, 'greeter').waitFor({ timeout: 30_000 });
    // Warm up the webview's context menu once.
    await openContextMenu(demo, sidebarRow(frame, 'greeter'));
    await demo.page.keyboard.press('Escape');
    await parkMouse(demo.page);
  },
  async run(demo) {
    const page = demo.page;
    const frame = sidebarFrame(page);
    await demo.pause(700);
    await openContextMenu(demo, sidebarRow(frame, 'greeter'));
    const item = menuItem(page, 'Compare with Repository');
    await item.waitFor({ timeout: 10_000 });
    await demo.pause(600);
    await demo.click(item);
    const modified = await addedTrait(page);
    await hideCursor(demo);
    await demo.mark('key', modified);
    await hold(demo, 'compare-with-repository', 2500);
  },
};

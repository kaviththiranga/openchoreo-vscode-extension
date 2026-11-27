// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import { api } from '../../cluster';
import { childRow, parkMouse, prepareSidebar, row, setExpanded } from './sidebar';

const PROJECT = 'gcp-microservice-demo';
const COMPONENT = 'frontend';
const ROUTE = `/api/v1/namespaces/default/components/${COMPONENT}`;

const LABEL = 'team';
const VALUE = 'storefront';

interface Component { metadata: { labels?: Record<string, string> } & Record<string, unknown>; spec: Record<string, unknown> }

/**
 * Take the label the scene adds off the component again (off camera).
 * Labels aren't part of a release, so the edit and this restore leave releases alone.
 */
async function removeLabel(): Promise<void> {
  const { status, json } = await api('GET', ROUTE);
  if (status !== 200) throw new Error(`GET ${ROUTE}: ${status}`);
  const component = json as Component;
  if (!component.metadata.labels || !(LABEL in component.metadata.labels)) return;
  delete component.metadata.labels[LABEL];
  const put = await api('PUT', ROUTE, { metadata: component.metadata, spec: component.spec });
  if (put.status >= 300) throw new Error(`PUT ${ROUTE}: ${put.status} ${JSON.stringify(put.json)}`);
}

/**
 * Click a component in the sidebar, its live YAML opens from the cluster,
 * add an ownership label and save: the cluster has the change.
 */
export const editAndSave: Scene = {
  name: 'edit-and-save',
  title: 'Edit a live resource: open it from the sidebar, change it, save to the cluster',
  requires: ['cluster'],
  async setup(demo) {
    const page = demo.page;
    await removeLabel();
    await prepareSidebar(demo, 'default', PROJECT);
    const project = row(page, PROJECT);
    await setExpanded(demo, project, true, false);
    await childRow(page, project, COMPONENT).waitFor({ timeout: 60_000 });
    await parkMouse(page);
  },
  async run(demo) {
    const page = demo.page;
    const editor = page.locator('.editor-instance .monaco-editor').first();
    const line = (text: string) => editor.locator('.view-line', { hasText: text }).first();
    await demo.pause(600);
    await demo.click(childRow(page, row(page, PROJECT), COMPONENT));
    const projectLabel = line('openchoreo.dev/project: gcp-microservice-demo');
    await projectLabel.waitFor({ timeout: 30_000 });
    await demo.pause(1000);
    await demo.screenshot('opened');

    // A new label under the project one.
    const value = projectLabel.locator('span[class*="mtk"]', { hasText: /^gcp-microservice-demo$/ });
    await demo.click(value);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await demo.type(`${LABEL}: ${VALUE}`, 60);
    await page.keyboard.press('Escape');
    await demo.pause(600);
    await demo.press('Mod+S');
    const saved = page.locator('.notification-toast', { hasText: `Component '${COMPONENT}' updated on cluster.` });
    await saved.waitFor({ timeout: 30_000 });
    // The editor shows the cluster's copy again (a moment after saving), label
    // included, and the sidebar refreshes in place.
    await demo.pause(500);
    await line(`${LABEL}: ${VALUE}`).waitFor({ timeout: 15_000 });
    await childRow(page, row(page, PROJECT), COMPONENT).waitFor({ timeout: 30_000 });
    await demo.mark('key', saved);
    await demo.mark('result', line(`${LABEL}: ${VALUE}`));
    await demo.pause(1300);
    await demo.screenshot('saved');
  },
  async teardown() {
    await removeLabel();
  },
};

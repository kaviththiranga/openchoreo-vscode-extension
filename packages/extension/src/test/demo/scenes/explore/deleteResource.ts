// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import { api, until } from '../../cluster';
import { childRow, contextMenu, dialogButton, parkMouse, prepareSidebar, row, setExpanded, sidebar, waitForLoads } from './sidebar';

const PROJECT = 'url-shortener';
// The component create-resource adds: the only one this area may create in url-shortener.
const NAME = 'snip-qr-service';
const ROUTE = `/api/v1/namespaces/default/components/${NAME}`;

/** Off camera: the component in the project, ready to delete (create-resource's, made here when missing). */
async function seedComponent(): Promise<void> {
  const current = await api('GET', ROUTE);
  const deleting = current.status === 200 && !!(current.json as { metadata?: { deletionTimestamp?: string } }).metadata?.deletionTimestamp;
  if (deleting) await until(async () => (await api('GET', ROUTE)).status === 404, 90_000);
  if (current.status === 200 && !deleting) return;
  const created = await api('POST', '/api/v1/namespaces/default/components', {
    metadata: { name: NAME, namespace: 'default' },
    spec: {
      owner: { projectName: PROJECT },
      componentType: { kind: 'ClusterComponentType', name: 'deployment/service' },
      autoDeploy: true,
    },
  });
  if (created.status >= 300) throw new Error(`creating ${NAME}: ${created.status} ${JSON.stringify(created.json)}`);
  await until(async () => (await api('GET', ROUTE)).status === 200, 60_000);
}

/** Delete a component from its context menu, with a confirmation, and watch it leave the tree. */
export const deleteResource: Scene = {
  name: 'delete-resource',
  title: 'Delete a resource from the sidebar: confirm, and it leaves the cluster',
  requires: ['cluster'],
  async setup(demo) {
    const page = demo.page;
    await seedComponent();
    await prepareSidebar(demo, 'default', PROJECT);
    const project = row(page, PROJECT);
    await project.waitFor({ timeout: 60_000 });
    await setExpanded(demo, project, true, false);
    await childRow(page, project, NAME).waitFor({ timeout: 60_000 });
    await parkMouse(page);
  },
  async run(demo) {
    const page = demo.page;
    const project = row(page, PROJECT);
    const target = childRow(page, project, NAME);
    await demo.pause(600);
    const menu = await contextMenu(demo, target);
    await demo.pause(700);
    await demo.click(menu.locator('.action-item', { hasText: /^Delete$/ }));
    const confirm = page.locator('.monaco-dialog-box', { hasText: NAME });
    await confirm.waitFor({ timeout: 15_000 });
    await demo.pause(1100);
    await demo.screenshot('confirm');
    await demo.click(dialogButton(page, 'Delete'));
    const done = page.locator('.notification-toast', { hasText: `Deleted component '${NAME}'.` });
    await done.waitFor({ timeout: 30_000 });
    // The tree reloads: the component is gone, or marked (deleting) while its finalizers run.
    await childRow(page, project, 'snip-redis').waitFor({ timeout: 30_000 });
    await waitForLoads(page);
    const gone = sidebar(page).locator('.tree-row', { hasText: NAME });
    await until(async () => (await gone.count()) === 0 || (await gone.first().innerText()).includes('(deleting)'), 15_000, 300);
    await demo.pause(200);
    await demo.mark('key', project.locator('xpath=..'));
    await demo.mark('toast', done);
    await demo.pause(1600);
    await demo.screenshot('deleted');
  },
};

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Locator } from 'playwright-core';
import type { Scene } from '../../demo';
import { api, until } from '../../cluster';
import { childRow, contextMenu, dialogButton, glide, parkMouse, prepareSidebar, row, setExpanded } from './sidebar';

const PROJECT = 'url-shortener';
const NAME = 'snip-qr-service';

/** A token of the editor's text, e.g. a YAML value. */
function token(editor: Locator, text: string): Locator {
  return editor.locator('.view-line span[class*="mtk"]', { hasText: new RegExp(`^${text}$`) }).first();
}

const route = () => `/api/v1/namespaces/default/components/${NAME}`;

async function removeComponent(): Promise<void> {
  await api('DELETE', route());
  await until(async () => (await api('GET', route())).status === 404, 90_000);
}

/**
 * Create a Component from the project's context menu: the scaffold opens
 * pre-filled with the namespace and project, the component type comes from
 * the cluster through completion, and saving creates it on the cluster.
 */
export const createResource: Scene = {
  name: 'create-resource',
  title: 'Create a Component from a pre-filled scaffold: completion from the cluster, save to create',
  requires: ['cluster'],
  async setup(demo) {
    const page = demo.page;
    await removeComponent();
    await prepareSidebar(demo, 'default', PROJECT);
    const project = row(page, PROJECT);
    await project.waitFor({ timeout: 60_000 });
    await setExpanded(demo, project, true, false);
    await childRow(page, project, 'snip-frontend').waitFor({ timeout: 60_000 });
    // The refresh lands in the background: wait until an earlier take's component has left the tree.
    await until(async () => (await childRow(page, project, NAME).count()) === 0, 60_000, 300);
    await parkMouse(page);
  },
  async run(demo) {
    const page = demo.page;
    const editor = page.locator('.editor-instance .monaco-editor').first();
    /** Click right before `target`'s first character and select to the end of its line. */
    const selectFrom = async (target: Locator) => {
      const at = await glide(demo, target, 'start');
      await demo.mark('click', target);
      await page.mouse.click(at.x, at.y);
      await page.keyboard.press('Shift+End');
      await demo.pause(250);
    };
    await demo.pause(600);
    const menu = await contextMenu(demo, row(page, PROJECT));
    await demo.pause(700);
    await demo.click(menu.locator('.action-item', { hasText: 'Create Component' }));
    await editor.locator('.view-lines', { hasText: 'my-component' }).waitFor({ timeout: 30_000 });
    await demo.pause(900);

    // A name for the new service.
    await selectFrom(token(editor, 'my-component'));
    await demo.type(NAME, 30);
    await page.keyboard.press('Escape');
    await demo.pause(300);

    // Its type, from the component types on the cluster.
    await selectFrom(editor.locator('.view-line', { hasText: 'name: deployment/service' })
      .locator('span[class*="mtk"]', { hasText: /^deployment/ }).first());
    await page.keyboard.press('Backspace');
    await demo.press('Control+Space');
    const suggest = page.locator('.suggest-widget.visible');
    await suggest.locator('.monaco-list-row', { hasText: 'deployment/web-application' }).waitFor({ timeout: 15_000 });
    await demo.pause(900);
    await demo.mark('completion', suggest);
    await demo.type('serv', 90);
    await suggest.locator('.monaco-list-row.focused', { hasText: 'deployment/service', hasNotText: 'with-configs' }).waitFor({ timeout: 10_000 });
    await demo.pause(300);
    await page.keyboard.press('Enter');
    await demo.pause(400);

    // Where its source lives.
    const url = editor.locator('.view-line', { hasText: 'url: https://github.com/my-org/my-repo' })
      .locator('span[class*="mtk"]', { hasText: /^https:/ }).first();
    await selectFrom(url);
    await demo.type(`https://github.com/acme/${NAME}`, 25);
    await demo.pause(500);

    await demo.press('Mod+S');
    const created = page.locator('.notification-toast', { hasText: `Component '${NAME}' created on cluster.` });
    await created.waitFor({ timeout: 30_000 });
    const newRow = childRow(page, row(page, PROJECT), NAME);
    await newRow.waitFor({ timeout: 30_000 });
    // The extension closes the scaffold tab 50 ms after the save returns; on a
    // loaded host VS Code hasn't marked it saved yet and asks to save it again
    // (extension race). The resource exists by then, so let the draft go.
    const createdTab = page.locator('.tab', { hasText: `${NAME}.yaml` });
    const dontSave = dialogButton(page, "Don't Save");
    await createdTab.or(dontSave).first().waitFor({ timeout: 30_000 });
    if (await dontSave.isVisible()) await dontSave.click();
    await createdTab.waitFor({ timeout: 30_000 });
    await demo.pause(300);
    await demo.mark('key', newRow);
    await demo.mark('toast', created);
    await demo.pause(1600);
    await demo.screenshot('created');
  },
  async teardown() {
    // The cluster goes back to how it was; the next setup waits for the delete to finish.
    await api('DELETE', route());
  },
};

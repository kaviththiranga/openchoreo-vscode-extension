// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import { activeEditor, dialogButton, doubleClick, editorToken, expandSidebarRows, hideCursor, hold, parkMouse, showOpenChoreo, sidebarFrame, sidebarRow, toast } from './ui';
import { resetWorkspace } from './workspace';

/**
 * A Flux-managed Component carries a merge badge in the sidebar. Saving an
 * edit to it asks first — the next sync would revert an API change — and
 * Change in Repository edits the declaring file in the GitOps repository
 * instead, keeping its layout, saved and ready to commit. The cluster is
 * untouched, so the scene repeats after the workspace reset.
 */
export const gitopsGuard: Scene = {
  name: 'gitops-guard',
  title: 'Saving a Flux-managed resource asks first; Change in Repository edits the declaring file, ready to commit',
  requires: ['cluster', 'gitops-workspace'],
  teardown: async () => resetWorkspace(),
  async setup(demo) {
    resetWorkspace();
    const page = demo.page;
    const frame = await showOpenChoreo(demo, 430);
    await expandSidebarRows(frame, ['shop']);
    const greeter = sidebarRow(frame, 'greeter');
    await greeter.locator('.tree-gitops').waitFor({ timeout: 30_000 });
    // Warm up: the first YAML editor of a session waits for the grammar and the fetch.
    await greeter.click();
    await editorToken(page, 'dockerfile-builder').waitFor({ timeout: 30_000 });
    await demo.command('View: Close All Editors');
    await demo.pause(500);
    await parkMouse(page);
  },
  async run(demo) {
    const page = demo.page;
    const greeter = sidebarRow(sidebarFrame(page), 'greeter');
    await demo.mark('badge', greeter.locator('.tree-gitops'));
    await demo.pause(300);
    await demo.click(greeter);
    await editorToken(page, 'dockerfile-builder').waitFor({ timeout: 30_000 });
    await demo.pause(400);

    // Build from the release branch.
    await doubleClick(demo, editorToken(page, 'main'));
    await demo.type('release-1.2', 60);
    await demo.pause(300);
    await demo.press('Mod+S');
    const repoButton = dialogButton(page, 'Change in Repository');
    await repoButton.waitFor({ timeout: 30_000 });
    await demo.mark('guard', page.locator('.monaco-dialog-box').first());
    await hold(demo, 'save-guard', 1300);

    await demo.click(repoButton);
    await toast(page, /ready to commit/).waitFor({ timeout: 30_000 });
    const changed = activeEditor(page).locator('.view-line', { hasText: 'release-1.2' }).first();
    await changed.waitFor({ timeout: 30_000 });
    await hideCursor(demo);
    await demo.mark('key', changed);
    await hold(demo, 'changed-in-repository', 1600);
  },
};

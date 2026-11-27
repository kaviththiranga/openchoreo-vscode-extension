// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

// Callbacks passed to page.evaluate run in the workbench window.
/// <reference lib="dom" />

/** Workbench helpers for the GitOps scenes. */
import type { FrameLocator, Locator, Page } from 'playwright-core';
import type { Demo } from '../../demo';

const literal = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

/** Drag the side bar's sash so it is `width` px wide. */
export async function sidebarWidth(page: Page, width: number): Promise<void> {
  const sash = page.locator('.primary-sidebar-sash').first();
  const box = await sash.boundingBox();
  const bar = await page.locator('.part.sidebar').first().boundingBox();
  if (!box || !bar || Math.abs(bar.width - width) < 4) return;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(bar.x + width, y, { steps: 6 });
  await page.mouse.up();
}

function paneHeader(page: Page, title: RegExp): Locator {
  return page.locator('.part.sidebar .pane-header', { hasText: title }).first();
}

/** The Explorer pane (header and body) with this title. */
function pane(page: Page, title: RegExp): Locator {
  return page.locator('.part.sidebar .pane', { has: page.locator('.pane-header', { hasText: title }) }).first();
}

async function setPane(page: Page, title: RegExp, open: boolean): Promise<void> {
  const header = paneHeader(page, title);
  if (!(await header.isVisible())) return;
  if (((await header.getAttribute('aria-expanded')) === 'true') !== open) await header.click({ position: { x: 40, y: 11 } });
}

/** The Explorer with one pane open: the OpenChoreo GitOps view, or the folder's files. */
async function showExplorer(demo: Demo, width: number, files: boolean): Promise<void> {
  const page = demo.page;
  await demo.command('View: Show Explorer');
  await paneHeader(page, /OpenChoreo GitOps/i).waitFor({ timeout: 60_000 });
  await sidebarWidth(page, width);
  await setPane(page, /^\s*Outline/i, false);
  await setPane(page, /^\s*Timeline/i, false);
  await setPane(page, /shop-gitops/i, files);
  await setPane(page, /OpenChoreo GitOps/i, !files);
  await demo.pause(300);
}

/** The Explorer with only the OpenChoreo GitOps view open. */
export function showGitOpsView(demo: Demo, width: number): Promise<void> {
  return showExplorer(demo, width, false);
}

/** The Explorer with only the workspace's files open. */
export function showFiles(demo: Demo, width: number): Promise<void> {
  return showExplorer(demo, width, true);
}

/** The GitOps view's tree. */
export function gitopsTree(page: Page): Locator {
  return pane(page, /OpenChoreo GitOps/i).locator('.monaco-list').first();
}

/** A row of the GitOps view by its label (a resource name, kind or namespace); the first when repeated. */
export function gitopsRow(page: Page, label: string): Locator {
  return gitopsTree(page).locator('.monaco-list-row', { has: page.locator('.label-name', { hasText: literal(label) }) }).first();
}

/** Expand (or fold) the GitOps view's rows with these labels, top to bottom. */
export async function expandGitOpsRows(page: Page, labels: string[], open = true): Promise<void> {
  for (const label of labels) {
    const item = gitopsRow(page, label);
    await item.waitFor({ timeout: 30_000 });
    if (((await item.getAttribute('aria-expanded')) === 'true') !== open) await item.locator('.monaco-tl-twistie').click();
    await page.waitForTimeout(150);
  }
}

/** Wait until no visible GitOps view entry is "not checked yet". */
export async function syncChecked(page: Page, timeout = 60_000): Promise<void> {
  await page.waitForFunction(() => {
    const icons = Array.from(document.querySelectorAll('.part.sidebar .custom-view-tree-node-item-icon'));
    return icons.length > 0 && !icons.some((i) => i.classList.contains('codicon-circle-outline'));
  }, undefined, { timeout });
}

/** Run the GitOps view's sync check (through the palette, off camera) and wait for it. */
export async function checkSync(demo: Demo): Promise<void> {
  await demo.command('OpenChoreo: Check Sync with Cluster');
  await demo.page.waitForTimeout(1000);
  await syncChecked(demo.page);
}

// CSS locators only: getByRole/getByText walk VS Code's whole DOM and take seconds on camera.

/** A GitOps view title-bar button by the start of its tooltip. */
export function gitopsAction(page: Page, title: string): Locator {
  return pane(page, /OpenChoreo GitOps/i).locator(`.pane-header .action-label[aria-label^="${title}"]`).first();
}

/** An editor title-bar button of the active editor by the start of its tooltip. */
export function editorAction(page: Page, title: string): Locator {
  return page.locator(`.editor-group-container.active .editor-actions .action-label[aria-label^="${title}"]`).first();
}

/** A button of the open modal dialog. */
export function dialogButton(page: Page, label: string): Locator {
  return page.locator('.monaco-dialog-box .monaco-button', { hasText: literal(label) }).first();
}

/** A notification toast by its message. */
export function toast(page: Page, message: RegExp): Locator {
  return page.locator('.notifications-toasts .notification-list-item', { hasText: message }).first();
}

/** The OpenChoreo side bar's content: with no editor webviews open, the first webview is the side bar. */
export function sidebarFrame(page: Page): FrameLocator {
  // Webview iframes live outside the side bar part.
  return page.frameLocator('iframe.webview').first().frameLocator('iframe').first();
}

/** Show the OpenChoreo side bar, `width` px wide. */
export async function showOpenChoreo(demo: Demo, width: number): Promise<FrameLocator> {
  const page = demo.page;
  const icon = page.locator('.activitybar .action-item', { has: page.locator('[aria-label^="OpenChoreo"]') }).first();
  if (!(await icon.getAttribute('class'))?.includes('checked')) await icon.click();
  const frame = sidebarFrame(page);
  await frame.locator('.tree-row').first().waitFor({ timeout: 60_000 });
  await sidebarWidth(page, width);
  return frame;
}

/** A row of the OpenChoreo side bar by its label. */
export function sidebarRow(frame: FrameLocator, label: string): Locator {
  return frame.locator('.tree-row', { has: frame.locator('.tree-label', { hasText: literal(label) }) }).first();
}

/** Expand side-bar rows top to bottom (rows already open stay open). */
export async function expandSidebarRows(frame: FrameLocator, labels: string[]): Promise<void> {
  for (const label of labels) {
    const item = sidebarRow(frame, label);
    await item.waitFor({ timeout: 30_000 });
    if (await item.locator('.codicon-chevron-right').count()) await item.locator('.tree-chevron').click();
    await item.page().waitForTimeout(600);
  }
}

/** Glide the demo cursor (same look as Demo.click) and the mouse to an element, without clicking. */
export async function glide(demo: Demo, target: Locator): Promise<{ x: number; y: number }> {
  const box = await target.boundingBox();
  if (!box) throw new Error('target is not visible');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await demo.page.evaluate(
    ([tx, ty]) => {
      let cursor = document.getElementById('oc-demo-cursor');
      if (!cursor) {
        cursor = document.createElement('div');
        cursor.id = 'oc-demo-cursor';
        Object.assign(cursor.style, {
          position: 'fixed', left: '50%', top: '50%', width: '22px', height: '22px',
          marginLeft: '-11px', marginTop: '-11px', borderRadius: '50%', zIndex: '100000',
          background: 'rgba(255, 196, 0, 0.55)', border: '2px solid rgba(255, 255, 255, 0.9)',
          pointerEvents: 'none', transition: 'left 450ms ease, top 450ms ease',
        });
        document.body.appendChild(cursor);
      }
      cursor.style.left = `${tx}px`;
      cursor.style.top = `${ty}px`;
    },
    [x, y],
  );
  await demo.page.mouse.move(x, y, { steps: 4 });
  await demo.pause(500);
  return { x, y };
}

/** Right-click an element with the demo cursor until its context menu opens (a webview can drop the first one). */
export async function openContextMenu(demo: Demo, target: Locator): Promise<void> {
  const { x, y } = await glide(demo, target);
  await demo.mark('click', target);
  const menu = demo.page.locator('.monaco-menu').first();
  for (let attempt = 0; attempt < 3; attempt++) {
    await demo.page.mouse.click(x, y, { button: 'right' });
    if (await menu.waitFor({ timeout: 2500 }).then(() => true, () => false)) return;
    await demo.page.keyboard.press('Escape');
  }
  throw new Error('the context menu did not open');
}

/** Double-click an element with the demo cursor (selects the word under it in an editor). */
export async function doubleClick(demo: Demo, target: Locator): Promise<void> {
  const { x, y } = await glide(demo, target);
  await demo.mark('click', target);
  await demo.page.mouse.dblclick(x, y);
}

/** Cmd/Ctrl+click an element, holding the modifier long enough to show the link underline. */
export async function modClick(demo: Demo, target: Locator): Promise<void> {
  const { x, y } = await glide(demo, target);
  await demo.page.keyboard.down('ControlOrMeta');
  await demo.pause(700);
  await demo.mark('click', target);
  await demo.page.mouse.click(x, y);
  await demo.page.keyboard.up('ControlOrMeta');
}

/** A context-menu entry (menus render in the page with window.menuStyle custom). */
export function menuItem(page: Page, label: string): Locator {
  return page.locator('.monaco-menu .action-item', { has: page.locator('.action-label', { hasText: literal(label) }) }).first();
}

/**
 * Answer the open quick pick or input box: type `filter` (if any) and press
 * Enter. `value` waits for a prefilled input box (e.g. a branch name) first,
 * so consecutive prompts aren't confused.
 */
export async function answerQuickInput(demo: Demo, options: { filter?: string; value?: RegExp } = {}): Promise<void> {
  const page = demo.page;
  await page.locator('.quick-input-widget').waitFor({ state: 'visible', timeout: 15_000 });
  if (options.value) {
    const pattern = options.value;
    await page.waitForFunction(
      ([source, flags]) => new RegExp(source, flags).test((document.querySelector('.quick-input-widget input') as HTMLInputElement | null)?.value ?? ''),
      [pattern.source, pattern.flags] as const,
      { timeout: 15_000 },
    );
  }
  await demo.pause(500);
  if (options.filter) {
    await demo.type(options.filter, 45);
    await page.locator('.quick-input-list .monaco-list-row.focused', { hasText: options.filter }).waitFor({ timeout: 10_000 });
    await demo.pause(350);
  }
  await page.keyboard.press('Enter');
  await demo.pause(500);
}

/**
 * Hold the result for `ms` and take a screenshot early in the hold, so a slow
 * screenshot (on a busy machine) lengthens nothing.
 */
export async function hold(demo: Demo, label: string, ms: number): Promise<void> {
  const start = Date.now();
  await demo.pause(400);
  await demo.screenshot(label);
  await demo.pause(Math.max(200, ms - (Date.now() - start)));
}

/** Move the mouse out of the way (an empty stretch of the activity bar), so no tooltip covers the result. */
export async function parkMouse(page: Page): Promise<void> {
  await page.mouse.move(24, 560);
}

/** Fade the demo cursor out and park the mouse, for a clean final frame. */
export async function hideCursor(demo: Demo): Promise<void> {
  await parkMouse(demo.page);
  await demo.page.evaluate(() => {
    const cursor = document.getElementById('oc-demo-cursor');
    if (!cursor) return;
    cursor.style.transition = 'opacity 300ms ease';
    cursor.style.opacity = '0';
    setTimeout(() => cursor.remove(), 350);
  });
  await demo.pause(350);
}

/** A notification toast's button. */
export function toastButton(page: Page, label: string): Locator {
  return page.locator('.notifications-toasts .monaco-button', { hasText: literal(label) }).first();
}

/** The active editor (the modified side in a diff). */
export function activeEditor(page: Page): Locator {
  return page.locator('.editor-group-container.active .monaco-editor').last();
}

/** A token in the active editor, e.g. a value to change or a reference to follow. */
export function editorToken(page: Page, text: string): Locator {
  return activeEditor(page).locator('.view-line span span', { hasText: literal(text) }).first();
}

/** An editor tab by its file name. */
export function tab(page: Page, name: string): Locator {
  return page.locator('.tabs-container .tab', { has: page.locator('.label-name', { hasText: literal(name) }) }).first();
}

/** Wait until the active editor tab shows this file. */
export async function activeTab(page: Page, name: string, timeout = 30_000): Promise<void> {
  await page.locator('.tabs-container .tab.active', { has: page.locator('.label-name', { hasText: literal(name) }) }).waitFor({ timeout });
}

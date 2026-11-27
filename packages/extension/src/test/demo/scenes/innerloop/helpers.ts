// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

// Callbacks passed to page.evaluate run in the workbench window.
/// <reference lib="dom" />

import type { FrameLocator, Locator, Page } from 'playwright-core';
import type { Demo } from '../../demo';

/** The OpenChoreo sidebar: a webview inside the workbench's webview host frame. */
export function sidebar(page: Page): FrameLocator {
  return page.frameLocator('iframe.webview').first().frameLocator('iframe').first();
}

/** The `.tree-node` (row plus children) whose own row has this label, optionally inside another node. */
export function treeNode(page: Page, label: string | RegExp, within?: Locator): Locator {
  const frame = sidebar(page);
  const text = typeof label === 'string' ? new RegExp(`^${escape(label)}$`) : label;
  return (within ?? frame.locator('body'))
    .locator('.tree-node')
    .filter({ has: frame.locator(':scope > .tree-row .tree-label', { hasText: text }) })
    .first();
}

/** The clickable row of a tree node. */
export function treeRow(page: Page, label: string | RegExp, within?: Locator): Locator {
  return treeNode(page, label, within).locator(':scope > .tree-row');
}

/** Expand a tree node off camera and wait for its children. */
export async function expand(node: Locator): Promise<void> {
  const row = node.locator(':scope > .tree-row');
  await row.waitFor({ timeout: 60_000 });
  if ((await row.locator('.codicon-chevron-down').count()) === 0) await row.locator('.tree-chevron').click();
  await node.locator(':scope > .tree-children .tree-row').first().waitFor({ timeout: 60_000 });
  await node.locator(':scope > .tree-children .loading-text').waitFor({ state: 'detached', timeout: 60_000 }).catch(() => undefined);
}

/** Collapse a tree node if it is open. */
export async function collapse(node: Locator): Promise<void> {
  const row = node.locator(':scope > .tree-row');
  if ((await row.count()) && (await row.locator('.codicon-chevron-down').count())) await row.locator('.tree-chevron').click();
}

/** Open the OpenChoreo view in the side bar and wait for its tree. */
export async function showOpenChoreo(page: Page): Promise<void> {
  const icon = page.locator('.activitybar [aria-label^="OpenChoreo"]').first();
  await icon.waitFor({ timeout: 60_000 });
  const active = await icon.evaluate((el) => !!el.closest('.checked'));
  const visible = await page.locator('.part.sidebar').isVisible().catch(() => false);
  if (!active || !visible) await icon.click();
  await sidebar(page).locator('.tree-row').first().waitFor({ timeout: 60_000 });
}

/** Drag the side bar's sash so long labels fit. */
export async function widenSidebar(page: Page, x = 520): Promise<void> {
  const sash = page.locator('.primary-sidebar-sash').first();
  const box = await sash.boundingBox();
  if (!box || Math.abs(box.x - x) < 8) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
}

/** The open quick input (quick pick or input box). */
export function quickInput(page: Page): Locator {
  return page.locator('.quick-input-widget');
}

/** A quick pick row by its label (the codicon prefix is ignored). */
export function quickItem(page: Page, label: string | RegExp): Locator {
  const text = typeof label === 'string' ? new RegExp(`^\\s*${escape(label)}\\s*$`) : label;
  return quickInput(page)
    .locator('.quick-input-list .monaco-list-row')
    .filter({ has: page.locator('.label-name', { hasText: text }) })
    .first();
}

/** Choose a quick pick item on camera: the cursor glides to it and clicks. */
export async function pick(demo: Demo, label: string | RegExp): Promise<void> {
  const item = quickItem(demo.page, label);
  await item.waitFor({ timeout: 30_000 });
  await demo.pause(500);
  await demo.click(item);
}

/** A status bar entry contributed by the extension, by its item id. */
export function statusItem(page: Page, id: string): Locator {
  return page.locator(`.statusbar-item[id$="${id}"]`).first();
}

/** A status bar entry by (part of) its text. */
export function statusText(page: Page, text: string | RegExp): Locator {
  return page.locator('.statusbar-item').filter({ hasText: text }).first();
}

/** Glide the demo cursor to an element and right-click it (Demo.click only left-clicks). */
async function rightClick(demo: Demo, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('right-click target is not visible');
  const x = box.x + Math.min(box.width / 2, 120);
  const y = box.y + box.height / 2;
  await moveCursor(demo.page, x, y);
  await demo.pause(500);
  await demo.mark('click', target);
  await demo.page.mouse.click(x, y, { button: 'right' });
}

/**
 * Right-click `target` and return the context menu's `label` item once it shows.
 * A right-click can get lost while the webview tree re-renders (busy host): try again.
 */
export async function contextMenu(demo: Demo, target: Locator, label: string): Promise<Locator> {
  const item = menuItem(demo.page, label);
  for (let attempt = 1; ; attempt++) {
    await rightClick(demo, target);
    if (await item.waitFor({ timeout: 3_000 }).then(() => true, () => false)) return item;
    if (attempt === 3) throw new Error(`no "${label}" in the context menu`);
    await demo.page.keyboard.press('Escape');
    await demo.pause(300);
  }
}

/** A context menu item (custom menus render in the page). */
function menuItem(page: Page, label: string | RegExp): Locator {
  const text = typeof label === 'string' ? new RegExp(`^${escape(label)}$`) : label;
  return page.locator('.context-view .monaco-menu .action-item').filter({ has: page.locator('.action-label', { hasText: text }) }).first();
}

/** Same cursor as Demo.click, so right-clicks look the same. */
async function moveCursor(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
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
}

/** Close the panel and secondary side bar, so a scene starts uncluttered. */
export async function tidy(demo: Demo): Promise<void> {
  const page = demo.page;
  if (await page.locator('.part.panel').isVisible().catch(() => false)) await demo.command('View: Hide Panel');
  if (await page.locator('.part.auxiliarybar').isVisible().catch(() => false)) await demo.command('View: Hide Secondary Side Bar');
  await demo.pause(300);
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The active terminal's text (needs the DOM renderer: terminal.integrated.gpuAcceleration "off"). */
async function terminalText(page: Page): Promise<string> {
  return (await page.locator('.terminal-wrapper.active .xterm-rows').innerText().catch(() => '')).replace(/\u00a0/g, ' ');
}

/** A line of the active terminal (DOM renderer). */
export function terminalRow(page: Page, text: RegExp): Locator {
  return page.locator('.terminal-wrapper.active .xterm-rows > div').filter({ hasText: text }).first();
}

/** Wait until the active terminal shows `pattern`. */
export async function waitForTerminal(page: Page, pattern: RegExp, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pattern.test(await terminalText(page))) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`terminal never showed ${pattern}: ${(await terminalText(page)).slice(-400)}`);
}

/** The folder VS Code opened (DEMO_WORKSPACE). */
export function workspaceFolder(): string {
  const folder = process.env.DEMO_WORKSPACE;
  if (!folder) throw new Error('set DEMO_WORKSPACE to the scene\'s folder');
  return folder;
}

/** Park the real mouse over the empty editor area, so no hover (with a file path) lingers. */
export async function parkMouse(page: Page): Promise<void> {
  const size = await page.evaluate(() => [innerWidth, innerHeight]);
  await page.mouse.move(size[0] * 0.7, size[1] * 0.45, { steps: 4 });
}

/** Off camera: no debug session, terminal or panel left from an earlier scene. */
export async function resetWorkbench(demo: Demo, options: { keepBreakpoints?: boolean } = {}): Promise<void> {
  const page = demo.page;
  for (let i = 0; i < 3 && (await page.locator('.debug-toolbar').isVisible().catch(() => false)); i++) {
    await page.keyboard.press('Shift+F5');
    await page.locator('.debug-toolbar').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined);
  }
  await demo.command('Terminal: Kill All Terminals');
  await demo.pause(500);
  if (!options.keepBreakpoints) {
    await demo.command('Debug: Remove All Breakpoints');
    await demo.pause(300);
  }
  await tidy(demo);
}

/**
 * Off camera: make the panel open maximized next time (terminal scenes) or at
 * its normal height (debug scene). VS Code keeps the state across close/open.
 */
export async function presetPanel(demo: Demo, maximized: boolean): Promise<void> {
  const page = demo.page;
  // Through the Output view: opening the panel on the terminal would start a stray shell.
  if (!(await page.locator('.part.panel').isVisible().catch(() => false))) {
    await demo.command('View: Toggle Output');
    await page.locator('.part.panel').waitFor({ timeout: 10_000 });
    await demo.pause(300);
  }
  const isMax = await page.locator('.monaco-workbench .part.editor').isHidden().catch(() => false);
  if (isMax !== maximized) {
    await demo.command('View: Toggle Maximized Panel');
    await demo.pause(400);
  }
  await demo.command('View: Hide Panel');
  await demo.pause(300);
}

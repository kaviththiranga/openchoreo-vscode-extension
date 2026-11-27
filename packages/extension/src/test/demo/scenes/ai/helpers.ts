// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { FrameLocator, Locator, Page } from 'playwright-core';
import type { Demo } from '../../demo';

/** The OpenChoreo sidebar: a webview inside the workbench's webview host frame. */
export function sidebar(page: Page): FrameLocator {
  return page.frameLocator('iframe.webview').first().frameLocator('iframe').first();
}

/** A tree row by its exact label or a pattern. */
export function row(page: Page, label: string | RegExp): Locator {
  const frame = sidebar(page);
  const text = typeof label === 'string' ? new RegExp(`^${escape(label)}$`) : label;
  return frame.locator('.tree-row', { has: frame.locator('.tree-label', { hasText: text }) }).first();
}

/** A row nested directly under another row, e.g. one component's "Workflow Runs". */
export function childRow(page: Page, parent: Locator, label: string | RegExp): Locator {
  const frame = sidebar(page);
  const text = typeof label === 'string' ? new RegExp(`^${escape(label)}$`) : label;
  return parent
    .locator('xpath=../div[contains(@class,"tree-children")]/div[contains(@class,"tree-node")]/div[contains(@class,"tree-row")]')
    .filter({ has: frame.locator('.tree-label', { hasText: text }) })
    .first();
}

/** Expand a row (off camera) and wait for its children to load. */
export async function expand(page: Page, target: Locator): Promise<void> {
  await target.waitFor({ timeout: 60_000 });
  if ((await target.locator('.codicon-chevron-down').count()) === 0) await target.locator('.tree-chevron').click();
  await waitForLoads(page);
}

/** Collapse a row if it is open (off camera). */
export async function collapse(target: Locator): Promise<void> {
  if (await target.isVisible().catch(() => false) && (await target.locator('.codicon-chevron-down').count()) > 0) {
    await target.locator('.tree-chevron').click();
  }
}

/** Wait until no tree node shows "Loading...". */
async function waitForLoads(page: Page, timeoutMs = 60_000): Promise<void> {
  const loading = sidebar(page).locator('.loading-text');
  const deadline = Date.now() + timeoutMs;
  await page.waitForTimeout(300);
  while ((await loading.count()) > 0) {
    if (Date.now() > deadline) throw new Error('sidebar tree still loading');
    await page.waitForTimeout(300);
  }
}

/** Show the OpenChoreo view (off camera) and wait for its tree. */
export async function showOpenChoreo(page: Page): Promise<void> {
  const icon = page.locator('.activitybar [aria-label^="OpenChoreo"]').first();
  await icon.waitFor({ timeout: 60_000 });
  // Clicking the icon of the view already showing would hide the side bar.
  const title = page.locator('.part.sidebar .composite.title', { hasText: /OpenChoreo/i });
  if (!(await title.isVisible().catch(() => false))) await icon.click();
  await sidebar(page).locator('.tree-row').first().waitFor({ timeout: 60_000 });
}

/** Drag the side bar's sash so long labels fit. */
export async function widenSidebar(page: Page, x = 470): Promise<void> {
  const sash = page.locator('.primary-sidebar-sash').first();
  const box = await sash.boundingBox();
  if (!box || Math.abs(box.x - x) < 8) return;
  await drag(page, box, x);
}

/** Drag the sash on the chat (secondary side bar) edge so the chat is `width` px wide. */
export async function widenChat(page: Page, width = 600): Promise<void> {
  const part = page.locator('.part.auxiliarybar').first();
  const box = await part.boundingBox();
  if (!box) return;
  const vw = await page.evaluate(() => innerWidth);
  const target = vw - width;
  if (Math.abs(box.x - target) < 8) return;
  // The sash between the editor and the secondary side bar sits on the bar's left edge.
  const sashes = page.locator('.monaco-sash.vertical');
  for (let i = 0; i < (await sashes.count()); i++) {
    const s = await sashes.nth(i).boundingBox();
    if (s && Math.abs(s.x + s.width / 2 - box.x) < 6 && s.height > box.height / 2) {
      await drag(page, s, target);
      return;
    }
  }
}

/** Drag the sash on the panel's top edge so the panel is `height` px tall (the panel must be open). */
export async function setPanelHeight(page: Page, height: number): Promise<void> {
  const part = page.locator('.part.panel').first();
  const box = await part.boundingBox();
  if (!box) return;
  const target = box.y + box.height - height;
  if (Math.abs(box.y - target) < 8) return;
  const sashes = page.locator('.monaco-sash.horizontal');
  for (let i = 0; i < (await sashes.count()); i++) {
    const s = await sashes.nth(i).boundingBox();
    if (s && Math.abs(s.y + s.height / 2 - box.y) < 6 && s.width > box.width / 2) {
      await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
      await page.mouse.down();
      await page.mouse.move(s.x + s.width / 2, target, { steps: 6 });
      await page.mouse.up();
      await page.mouse.move(s.x + s.width / 2, target - 200);
      return;
    }
  }
}

async function drag(page: Page, box: { x: number; y: number; width: number; height: number }, x: number): Promise<void> {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  // Off the sash, so it doesn't stay highlighted on camera.
  await page.mouse.move(x + 200, box.y + box.height / 2);
}

/** The chat input (secondary side bar). */
export function chatInput(page: Page): Locator {
  return page.locator('.part.auxiliarybar .interactive-input-part').first();
}

/** Open the chat view (secondary side bar) on a fresh, empty session (off camera). */
export async function freshChat(demo: Demo): Promise<void> {
  const page = demo.page;
  await demo.command('Chat: Open Chat');
  await chatInput(page).waitFor({ timeout: 30_000 });
  // "Chat: New Chat" in the palette opens a chat editor; the view's own button starts a new session.
  const newChat = page.locator('.part.auxiliarybar .composite.title .action-label[aria-label^="New" i]').first();
  if (await newChat.isVisible().catch(() => false)) await newChat.click();
  await demo.pause(600);
  // Clear what an earlier hand-off left in the input.
  await chatInput(page).locator('.monaco-editor').first().click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  const remove = chatInput(page).locator('.chat-attached-context-attachment .codicon-close');
  for (let i = 0; i < 10 && (await remove.count()) > 0; i++) await remove.first().click();
}

/** Close the chat (secondary side bar) if it is open. */
export async function closeChat(demo: Demo): Promise<void> {
  if (await demo.page.locator('.part.auxiliarybar').first().isVisible().catch(() => false)) {
    await demo.command('View: Hide Secondary Side Bar');
    await demo.pause(400);
  }
}

/** Close the panel if it is open ("View: Hide Panel" is only in the palette while it shows). */
export async function closePanel(demo: Demo): Promise<void> {
  if (await demo.page.locator('.part.panel').first().isVisible().catch(() => false)) {
    await demo.command('View: Hide Panel');
    await demo.pause(300);
  }
}

/** Right-click a tree row and choose a context menu item, on camera. */
export async function contextMenu(demo: Demo, target: Locator, item: string): Promise<Locator> {
  const menuItem = demo.page.locator('.context-view .action-label', { hasText: new RegExp(`^${escape(item)}$`) }).first();
  for (let attempt = 0; attempt < 3; attempt++) {
    const box = await target.boundingBox();
    if (!box) throw new Error('context menu target is not visible');
    await target.click({ button: 'right', position: { x: Math.min(120, box.width / 2), y: box.height / 2 } });
    if (await menuItem.waitFor({ timeout: 4000 }).then(() => true, () => false)) return menuItem;
    await demo.page.keyboard.press('Escape');
    await demo.pause(400);
  }
  throw new Error(`context menu item "${item}" did not appear`);
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

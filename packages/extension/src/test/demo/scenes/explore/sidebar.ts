// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { FrameLocator, Locator, Page } from 'playwright-core';
import type { Demo } from '../../demo';

/** The OpenChoreo sidebar: a webview inside the workbench's webview host frame. */
export function sidebar(page: Page): FrameLocator {
  return page.frameLocator('iframe.webview').first().frameLocator('iframe').first();
}

/** A tree row by its label (exact string or pattern). */
export function row(page: Page, label: string | RegExp): Locator {
  const frame = sidebar(page);
  const text = typeof label === 'string' ? new RegExp(`^${escape(label)}$`) : label;
  return frame.locator('.tree-row', { has: frame.locator('.tree-label', { hasText: text }) }).first();
}

/** A row nested under another row, e.g. the "Release Bindings" of one component. */
export function childRow(page: Page, parent: Locator, label: string | RegExp): Locator {
  const frame = sidebar(page);
  const text = typeof label === 'string' ? new RegExp(`^${escape(label)}$`) : label;
  return parent
    .locator('xpath=../div[contains(@class,"tree-children")]/div[contains(@class,"tree-node")]/div[contains(@class,"tree-row")]')
    .filter({ has: frame.locator('.tree-label', { hasText: text }) })
    .first();
}

/** A section header ("Projects", "Namespace Resources", "Cluster Resources"). */
export function section(page: Page, title: string): Locator {
  const frame = sidebar(page);
  return frame.locator('.section-header', { has: frame.locator('.section-title', { hasText: new RegExp(`^${escape(title)}$`) }) });
}

export async function isExpanded(target: Locator): Promise<boolean> {
  return (await target.locator('.codicon-chevron-down').count()) > 0;
}

/** Expand (or collapse) a row through its chevron, on camera with the demo cursor when `animate`. */
export async function setExpanded(demo: Demo, target: Locator, open: boolean, animate = true): Promise<void> {
  if ((await isExpanded(target)) === open) return;
  const chevron = target.locator('.tree-chevron, .section-chevron').first();
  if (animate) await demo.click(chevron);
  else await chevron.click();
}

/** Open the OpenChoreo view and wait for its tree. Off camera: no cursor animation. */
export async function showOpenChoreo(page: Page): Promise<void> {
  const icon = page.locator('.activitybar [aria-label^="OpenChoreo"]').first();
  await icon.waitFor({ timeout: 60_000 });
  // Clicking the icon of the view already showing would hide the side bar.
  const title = page.locator('.part.sidebar .composite.title', { hasText: /OpenChoreo/i });
  if (!(await title.isVisible().catch(() => false))) await icon.click();
  await section(page, 'Projects').waitFor({ timeout: 60_000 });
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

/**
 * Collapse every tree node and section except Projects, so each scene starts
 * from the same tree. The webview remembers expanded nodes per namespace and
 * its Collapse All only reaches visible ones, so open every project first.
 */
export async function resetTree(page: Page): Promise<void> {
  const frame = sidebar(page);
  for (const title of ['Projects', 'Namespace Resources', 'Cluster Resources']) {
    const header = section(page, title);
    if ((await header.locator('.codicon-chevron-down').count()) === 0) await header.click();
    const body = header.locator('xpath=following-sibling::div[contains(@class,"section-body")]');
    await body.locator('.tree-row').first().waitFor({ timeout: 60_000 });
    if (title === 'Projects') {
      const closed = body.locator(':scope > .tree-node > .tree-row:has(.tree-chevron:not(.hidden) .codicon-chevron-right)');
      for (let i = 0; i < 20 && (await closed.count()) > 0; i++) await closed.first().locator('.tree-chevron').click();
      await waitForLoads(page);
    }
    await header.locator('.icon-button[title="Collapse All"]').click();
    if (title !== 'Projects') await header.click();
  }
  await frame.locator('.tree-row').first().waitFor({ timeout: 60_000 });
}

/** Wait until no tree node has shown "Loading..." for a moment (nested nodes load one level at a time). */
export async function waitForLoads(page: Page, timeoutMs = 60_000): Promise<void> {
  const loading = sidebar(page).locator('.loading-text');
  const deadline = Date.now() + timeoutMs;
  let quiet = 0;
  while (quiet < 3) {
    if (Date.now() > deadline) throw new Error('sidebar tree still loading');
    await page.waitForTimeout(300);
    quiet = (await loading.count()) > 0 ? 0 : quiet + 1;
  }
}

/** The namespace chip in the sidebar header. */
export function namespaceChip(page: Page): Locator {
  return sidebar(page).locator('.context-chip[title="Select Namespace"]');
}

/** Switch namespace through the chip's quick pick, off camera. */
export async function ensureNamespace(page: Page, name: string): Promise<void> {
  const chip = namespaceChip(page);
  await chip.waitFor({ timeout: 60_000 });
  if (((await chip.locator('.chip-text').textContent()) ?? '').trim() === name) return;
  await chip.click();
  await pickQuick(page, name);
  await chip.locator('.chip-text', { hasText: new RegExp(`^${escape(name)}$`) }).waitFor({ timeout: 30_000 });
}

/** Choose a quick pick item by its exact label. */
export async function pickQuick(page: Page, label: string): Promise<void> {
  const quick = page.locator('.quick-input-widget');
  await quick.waitFor({ state: 'visible', timeout: 30_000 });
  const item = quick.locator('.quick-input-list .monaco-list-row', {
    has: page.locator('.label-name', { hasText: new RegExp(`^${escape(label)}$`) }),
  }).first();
  await item.waitFor({ timeout: 30_000 });
  await item.click();
}

/**
 * Glide the demo cursor to `target` without clicking (the harness's cursor,
 * same look), for hovers and right-clicks.
 */
export async function glide(demo: Demo, target: Locator, at: 'center' | 'start' = 'center'): Promise<{ x: number; y: number }> {
  const box = await target.boundingBox();
  if (!box) throw new Error('glide target is not visible');
  const x = at === 'start' ? box.x + 2 : box.x + Math.min(box.width / 2, 90);
  const y = box.y + box.height / 2;
  await demo.page.evaluate(([tx, ty]) => {
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
  }, [x, y]);
  await demo.pause(500);
  return { x, y };
}

/** Hover an element with the demo cursor, e.g. a status bar item for its tooltip. */
export async function hover(demo: Demo, target: Locator): Promise<void> {
  const { x, y } = await glide(demo, target);
  await demo.page.mouse.move(x, y, { steps: 4 });
}

/**
 * Open a sidebar row's context menu. Webview rows get their menu from a
 * `contextmenu` event; a synthetic one is what reaches the webview under
 * headless Ozone (a real right-click does nothing there).
 */
export async function contextMenu(demo: Demo, target: Locator): Promise<Locator> {
  await glide(demo, target);
  await demo.mark('right-click', target);
  // A real MouseEvent: the workbench anchors the menu at the event's clientX/clientY.
  await target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, button: 2, clientX: r.left + Math.min(r.width / 2, 90), clientY: r.top + r.height / 2 };
    el.dispatchEvent(new MouseEvent('contextmenu', init));
  });
  const menu = demo.page.locator('.context-view .monaco-menu');
  await menu.waitFor({ timeout: 15_000 });
  return menu;
}

/** A button in a (custom-style) modal dialog. */
export function dialogButton(page: Page, name: string): Locator {
  return page.locator('.monaco-dialog-box .monaco-button', { hasText: new RegExp(`^${escape(name)}$`) });
}

/**
 * Off camera: leave no dialog or dirty editor behind from an earlier scene,
 * then show the OpenChoreo view, wide, on `namespace`, with only Projects open
 * and fresh data. `select` puts the tree's selection on that top-level row
 * (the one the scene starts with) instead of wherever the reset left it.
 */
export async function prepareSidebar(demo: Demo, namespace = 'default', select?: string): Promise<void> {
  const page = demo.page;
  await discardDirtyEditors(demo);
  await showOpenChoreo(page);
  await widenSidebar(page, 520);
  await ensureNamespace(page, namespace);
  // Fresh data for every section, expanded nodes included.
  for (const title of ['Projects', 'Namespace Resources', 'Cluster Resources']) {
    await section(page, title).locator(`.icon-button[title="Refresh ${title}"]`).click();
  }
  await resetTree(page);
  if (select) {
    const chevron = row(page, select).locator('.tree-chevron');
    await chevron.click();
    await waitForLoads(page);
    await chevron.click();
  }
  await demo.command('Notifications: Clear All Notifications');
  await parkMouse(page);
}

/** Close every editor without saving: a scene that failed half way may leave a draft open. */
export async function discardDirtyEditors(demo: Demo): Promise<void> {
  const page = demo.page;
  for (let i = 0; i < 3; i++) {
    const dontSave = dialogButton(page, "Don't Save");
    if (await dontSave.isVisible().catch(() => false)) {
      await dontSave.click();
      await demo.pause(500);
    }
    if ((await page.locator('.tabs-container .tab').count()) === 0) return;
    await demo.command('View: Close All Editors');
    await demo.pause(800);
  }
}

/**
 * Park the mouse over the editor area. It crosses the side bar's empty space
 * first: leaving the webview straight from a row keeps that row's hover look.
 */
export async function parkMouse(page: Page): Promise<void> {
  await page.mouse.move(200, 780, { steps: 3 });
  await page.mouse.move(1100, 500, { steps: 3 });
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

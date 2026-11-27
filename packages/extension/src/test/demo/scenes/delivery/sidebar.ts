// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

// Callbacks passed to page.evaluate run in the workbench window.
/// <reference lib="dom" />

import type { FrameLocator, Locator, Page } from 'playwright-core';
import type { Demo } from '../../demo';

/** The OpenChoreo sidebar: a webview inside the workbench's webview host iframe. */
function sidebarFrame(page: Page): FrameLocator {
  return page.frameLocator('iframe.webview').first().frameLocator('iframe').first();
}

/** Tree helpers for the sidebar. Rows are matched by their exact label, optionally inside another row's subtree. */
export class Sidebar {
  readonly frame: FrameLocator;

  constructor(private readonly demo: Demo) {
    this.frame = sidebarFrame(demo.page);
  }

  private get page(): Page {
    return this.demo.page;
  }

  /** The `.tree-node` (row plus children) whose own row has this label. */
  node(label: string | RegExp, within?: Locator): Locator {
    const text = typeof label === 'string' ? new RegExp(`^${escape(label)}$`) : label;
    const scope = within ?? this.frame.locator('.sidebar');
    return scope
      .locator('.tree-node')
      .filter({ has: this.frame.locator(':scope > .tree-row .tree-label', { hasText: text }) })
      .first();
  }

  /** The clickable row of a node. */
  row(label: string | RegExp, within?: Locator): Locator {
    return this.node(label, within).locator(':scope > .tree-row');
  }

  /** Open the OpenChoreo view in the side bar and widen the side bar so labels and descriptions fit. */
  async open(width = 560): Promise<void> {
    const page = this.page;
    const icon = page.locator('.activitybar [aria-label^="OpenChoreo"]').first();
    await icon.waitFor({ timeout: 60_000 });
    const selected = await icon.evaluate((el) => !!el.closest('.checked') || el.getAttribute('aria-pressed') === 'true' || el.parentElement?.classList.contains('checked'));
    if (!selected) await icon.click();
    await this.frame.locator('.section-header').first().waitFor({ timeout: 60_000 });
    const sash = page.locator('.primary-sidebar-sash').first();
    const box = await sash.boundingBox();
    if (box && Math.abs(box.x - width) > 4) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(width, box.y + box.height / 2, { steps: 5 });
      await page.mouse.up();
    }
    await this.parkMouse();
  }

  /** Reload the sidebar so a scene starts from freshly fetched data, whatever earlier scenes loaded. */
  async reload(): Promise<void> {
    await this.demo.command('Developer: Reload Webviews');
    await this.demo.pause(1500);
    await this.frame.locator('.section-header').first().waitFor({ timeout: 60_000 });
    await this.frame.locator('.tree-row').first().waitFor({ timeout: 60_000 });
  }

  /** Move the real mouse over the editor area, so no sash or tree row shows a hover state. */
  async parkMouse(): Promise<void> {
    const [w, h] = await this.page.evaluate(() => [innerWidth, innerHeight]);
    await this.page.mouse.move(w - 200, h / 2);
  }

  /** Fold every section and keep only Projects open, so a scene starts from a tidy tree. */
  async reset(): Promise<void> {
    const sections = this.frame.locator('.tree-section');
    const count = await sections.count();
    for (let i = 0; i < count; i++) {
      const section = sections.nth(i);
      const title = (await section.locator('.section-title').textContent())?.trim() ?? '';
      const open = (await section.locator('.section-chevron.codicon-chevron-down').count()) > 0;
      if (open) await section.locator('.section-header [title="Collapse All"]').click();
      const wantOpen = /^projects$/i.test(title);
      if (open !== wantOpen) await section.locator('.section-header').click({ position: { x: 30, y: 10 } });
    }
    await this.page.waitForTimeout(300);
  }

  /**
   * Off camera: a tidy tree with one component open and the given child
   * categories (e.g. 'Release Bindings') expanded. Returns the component node.
   */
  async showComponent(project: string, component: string, categories: string[], width = 560): Promise<Locator> {
    await this.open(width);
    // Fold first: Collapse All only reaches nodes whose children are loaded, which a reload clears.
    await this.reset();
    await this.reload();
    const proj = await this.expand(project);
    const comp = await this.expand(component, proj);
    for (const category of categories) await this.expand(category, comp);
    await this.parkMouse();
    return comp;
  }

  /** The Projects section's Refresh button (shown on hover). */
  refreshButton(): Locator {
    return this.frame.locator('.section-header', { hasText: /projects/i }).locator('[title^="Refresh"]').first();
  }

  async isExpanded(node: Locator): Promise<boolean> {
    return (await node.getAttribute('aria-expanded')) === 'true';
  }

  /** Expand a node (on camera with the cursor when `animate`), then wait for its children to load. */
  async expand(label: string | RegExp, within?: Locator, animate = false): Promise<Locator> {
    const node = this.node(label, within);
    await node.waitFor({ timeout: 30_000 });
    if (!(await this.isExpanded(node))) {
      const chevron = node.locator(':scope > .tree-row .tree-chevron');
      if (animate) await this.demo.click(chevron);
      else await chevron.click();
    }
    await this.childrenLoaded(node);
    return node;
  }

  async collapse(label: string | RegExp, within?: Locator): Promise<void> {
    const node = this.node(label, within);
    if ((await node.count()) && (await this.isExpanded(node))) await node.locator(':scope > .tree-row .tree-chevron').click();
  }

  /** Wait until an expanded node shows children rather than its Loading row. */
  async childrenLoaded(node: Locator, timeout = 30_000): Promise<void> {
    const children = node.locator(':scope > .tree-children');
    await children.locator('.tree-node').first().waitFor({ timeout });
  }

  /** Right-click an element with the visible cursor, as Demo.click does for a left click. */
  async rightClick(target: Locator): Promise<void> {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error('right-click target is not visible');
    const x = box.x + Math.min(box.width / 2, 140);
    const y = box.y + box.height / 2;
    await moveCursor(this.page, x, y);
    await this.demo.pause(500);
    await this.demo.mark('click', target);
    await this.page.mouse.click(x, y, { button: 'right' });
  }

  /** Right-click a row and pick an item of its context menu. */
  async menu(target: Locator, item: string): Promise<void> {
    await this.rightClick(target);
    const entry = menuItem(this.page, item);
    // Coming from another part of the window, the first right-click only focuses the webview.
    const opened = await this.page.locator('.context-view .monaco-menu').waitFor({ timeout: 1500 }).then(() => true, () => false);
    if (!opened) {
      const box = await target.boundingBox();
      if (box) await this.page.mouse.click(box.x + Math.min(box.width / 2, 140), box.y + box.height / 2, { button: 'right' });
    }
    await entry.waitFor({ timeout: 10_000 });
    await this.demo.pause(600);
    await this.demo.click(entry);
  }
}

/** An item of the open context menu (custom menu style renders it in the page). */
function menuItem(page: Page, label: string): Locator {
  return page.locator('.context-view .monaco-menu .action-item').filter({
    has: page.locator('.action-label', { hasText: new RegExp(`^${escape(label)}$`) }),
  }).first();
}

/** A pre-filled ReleaseBinding is open: show it, then Mod+S applies it. */
export async function applyBinding(demo: Demo, release: string): Promise<void> {
  const editor = demo.page.locator('.editor-group-container .monaco-editor').first();
  await editor.locator('.view-line', { hasText: `releaseName: ${release}` }).first().waitFor({ timeout: 30_000 });
  await demo.pause(1000);
  await demo.press('Mod+S');
  await demo.page.locator('.tab.active:not(.dirty)').first().waitFor({ timeout: 30_000 });
}

/** Wait until an environment's row shows the release (the sidebar refreshes itself after a save). */
export async function waitForRelease(row: Locator, release: string): Promise<Locator> {
  await row.locator('.tree-description', { hasText: release }).waitFor({ timeout: 30_000 });
  return row;
}

/** Close the bottom panel if it is open. */
export async function closePanel(demo: Demo): Promise<void> {
  if (await demo.page.locator('.part.panel').isVisible().catch(() => false)) await demo.command('View: Toggle Panel Visibility');
}

/**
 * Off camera: make the bottom panel open maximized next time (the panel
 * restores the size it was closed at), so logs fill the editor area.
 */
export async function maximizeNextPanel(demo: Demo): Promise<void> {
  const page = demo.page;
  await demo.command('Output: Focus on Output View');
  const panel = page.locator('.part.panel');
  await panel.waitFor({ state: 'visible', timeout: 10_000 });
  await demo.pause(300);
  const box = await panel.boundingBox();
  const height = await page.evaluate(() => innerHeight);
  if (!box || box.height < height * 0.6) await demo.command('View: Toggle Maximized Panel');
  await demo.pause(300);
  await demo.command('View: Toggle Panel Visibility');
  await demo.pause(300);
}

/** The text editor of the Output panel. */
export function outputView(page: Page): Locator {
  return page.locator('.part.panel .output-view .monaco-editor .view-lines').first();
}

/** Pick a visible quick-pick row by its label with the cursor. */
export async function pickQuickItem(demo: Demo, label: string | RegExp): Promise<void> {
  const quick = demo.page.locator('.quick-input-widget');
  await quick.waitFor({ state: 'visible', timeout: 15_000 });
  const row = quick.locator('.monaco-list-row', { hasText: label }).first();
  await row.waitFor({ timeout: 15_000 });
  await demo.pause(400);
  await demo.click(row);
}

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

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

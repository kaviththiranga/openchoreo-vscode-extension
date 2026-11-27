// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

// Callbacks passed to page.evaluate run in the workbench window.
/// <reference lib="dom" />

/**
 * Editor helpers for the language scenes: workspace files, the suggest
 * widget, indentation and hovering. The workspaces come from
 * demo/seed/workspaces-language.sh (url-shortener and platform-config).
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { Locator } from 'playwright-core';
import type { Demo } from '../../demo';

/** A path in the workspace folder VS Code opened (DEMO_WORKSPACE). */
export function workspacePath(rel: string): string {
  const root = process.env.DEMO_WORKSPACE;
  if (!root) throw new Error('set DEMO_WORKSPACE to a folder made by demo/seed/workspaces-language.sh');
  return path.resolve(root, rel);
}

/** Write a file the scene starts from (on disk, before VS Code opens it). */
export function writeWorkspaceFile(rel: string, lines: string[]): void {
  const file = workspacePath(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n'));
}

/** The 1-based line of a workspace file that starts with `prefix`. */
export function workspaceLine(rel: string, prefix: string): number {
  const index = fs.readFileSync(workspacePath(rel), 'utf8').split('\n').findIndex((l) => l.startsWith(prefix));
  if (index < 0) throw new Error(`no line starting with "${prefix}" in ${rel}`);
  return index + 1;
}

/**
 * Put the workspace back to its seeded commit: files other scenes wrote or
 * changed go away, so every scene starts from the same tree.
 */
export function resetWorkspace(): void {
  const cwd = workspacePath('.');
  execFileSync('git', ['checkout', '-q', '--', '.'], { cwd });
  execFileSync('git', ['clean', '-fdq'], { cwd });
}

/** Open a workspace file by its path relative to the workspace (Quick Open). */
export async function openWorkspaceFile(demo: Demo, rel: string): Promise<void> {
  await demo.openFile(rel);
  await demo.page.locator('.tab.active', { hasText: path.basename(rel) }).first().waitFor({ timeout: 15_000 });
}

/**
 * Hold on the current frame for `ms` while taking a 2x still of it. The still
 * waits for that exact frame; on a busy machine it can take longer than `ms`,
 * which only lengthens the hold.
 */
export async function holdWithStill(demo: Demo, label: string, ms: number): Promise<void> {
  const start = Date.now();
  await demo.screenshot(label);
  await demo.pause(Math.max(0, ms - (Date.now() - start)));
}

export const suggestWidget = (demo: Demo): Locator => demo.page.locator('.monaco-editor .suggest-widget.visible');

/** A row of the open suggest widget. */
export function suggestion(demo: Demo, label: string | RegExp): Locator {
  const text = typeof label === 'string' ? new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) : label;
  return suggestWidget(demo).locator('.monaco-list-row', { has: demo.page.locator('.label-name', { hasText: text }) }).first();
}

/**
 * Off camera: open suggestions at `line:column` until one matching `label`
 * shows, i.e. the language server has the cluster's names. Leaves the cursor there.
 */
export async function waitForSuggestions(demo: Demo, line: number, column: number, label: string, timeoutMs = 90_000): Promise<void> {
  const page = demo.page;
  await demo.goTo(line, column);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await page.keyboard.press('Control+Space');
    const found = await suggestion(demo, label).waitFor({ timeout: 3000 }).then(() => true, () => false);
    await page.keyboard.press('Escape');
    if (found) return;
    if (Date.now() > deadline) throw new Error(`no "${label}" suggestion at ${line}:${column}: is the cluster reachable?`);
    await demo.pause(2000);
  }
}

/** The cursor position from the status bar, after it shows line `expectLine` (it updates a moment late). */
async function cursorColumn(demo: Demo, expectLine: number): Promise<number> {
  const item = demo.page.locator('[id="status.editor.selection"]');
  for (let i = 0; i < 50; i++) {
    const m = /Ln (\d+), Col (\d+)/.exec(await item.innerText().catch(() => ''));
    if (m && Number(m[1]) === expectLine) return Number(m[2]);
    await demo.pause(40);
  }
  throw new Error(`cursor did not reach line ${expectLine}`);
}

async function cursorLine(demo: Demo): Promise<number> {
  const m = /Ln (\d+)/.exec(await demo.page.locator('[id="status.editor.selection"]').innerText());
  if (!m) throw new Error('no cursor position in the status bar');
  return Number(m[1]);
}

/**
 * Start a new line indented by `indent` spaces, the way a person would with
 * Enter and Tab or Backspace. VS Code keeps the previous line's indentation
 * in YAML, so this reads where the cursor landed instead of assuming it.
 */
export async function newLine(demo: Demo, indent: number): Promise<void> {
  const line = await cursorLine(demo);
  await demo.page.keyboard.press('Escape');
  await demo.page.keyboard.press('Enter');
  await indentTo(demo, line + 1, indent);
}

/** With the cursor at the end of line `line`'s indentation, make it `indent` spaces. */
async function indentTo(demo: Demo, line: number, indent: number): Promise<void> {
  let column = await cursorColumn(demo, line);
  while (column - 1 < indent) {
    await demo.page.keyboard.press('Tab');
    column += 2;
  }
  while (column - 1 > indent) {
    await demo.page.keyboard.press('Backspace');
    column -= 2;
  }
  await demo.pause(120);
}

/** Move the cursor `lines` down with the arrow keys, to the end of that line. */
export async function moveToLineEnd(demo: Demo, lines: number): Promise<void> {
  await demo.page.keyboard.press('Escape');
  for (let i = 0; i < lines; i++) {
    await demo.page.keyboard.press('ArrowDown');
    await demo.pause(110);
  }
  await demo.page.keyboard.press('End');
  await demo.pause(300);
}

/** Type `text`, then accept the suggestion `label` once the widget shows it. */
export async function typeAndAccept(demo: Demo, text: string, label: string | RegExp, delay = 70): Promise<void> {
  await demo.type(text, delay);
  await suggestion(demo, label).waitFor({ timeout: 10_000 });
  await demo.pause(350);
  await selectSuggestion(demo, label);
}

/** Move the selection to `label` with the arrow keys, then accept it. */
export async function selectSuggestion(demo: Demo, label: string | RegExp): Promise<void> {
  const page = demo.page;
  const row = suggestion(demo, label);
  await row.waitFor({ timeout: 10_000 });
  for (let i = 0; i < 20 && !((await row.getAttribute('class')) ?? '').includes('focused'); i++) {
    await page.keyboard.press('ArrowDown');
    await demo.pause(140);
  }
  await demo.pause(250);
  await page.keyboard.press('Enter');
}

/** The rendered token `text` on the editor line containing `lineText`. */
export function editorToken(demo: Demo, lineText: string, text: string): Locator {
  return demo.page.locator('.monaco-editor .view-line', { hasText: lineText }).first()
    .locator('span > span', { hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first();
}

/** Glide the visible cursor (the same one Demo.click shows) and the mouse to a point. */
export async function glide(demo: Demo, x: number, y: number): Promise<void> {
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
  // One jump: a path across other keys would open their hovers on the way.
  await demo.page.mouse.move(x, y);
  await demo.pause(500);
}

/** Rest the mouse on an element so its hover shows. */
export async function hover(demo: Demo, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('hover target is not visible');
  await glide(demo, box.x + Math.min(box.width / 2, 40), box.y + box.height / 2);
}

/** The editor hover widget once it shows `text`. */
export function hoverWidget(demo: Demo, text: string | RegExp): Locator {
  return demo.page.locator('.monaco-hover:not(.hidden)', { hasText: text }).first();
}

/** Show the Explorer with the side bar at `width` px. */
async function showExplorer(demo: Demo, width: number): Promise<void> {
  const page = demo.page;
  await demo.command('View: Show Explorer');
  await demo.pause(400);
  const sash = page.locator('.primary-sidebar-sash').first();
  const box = await sash.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(width, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  // Off the sash, or it stays highlighted.
  await page.mouse.move(width + 300, 790);
}

/** Off camera: open the Problems panel, make it `height` px tall and close it again (VS Code keeps the size). */
export async function sizeProblemsPanel(demo: Demo, height: number): Promise<void> {
  const page = demo.page;
  await page.keyboard.press('ControlOrMeta+Shift+M');
  const panel = page.locator('.part.panel');
  await panel.waitFor({ timeout: 10_000 });
  await demo.pause(400);
  const box = await panel.boundingBox();
  if (box) {
    const x = box.x + box.width / 2;
    const bottom = box.y + box.height;
    // The sash sits just above the panel's top edge.
    await page.mouse.move(x, box.y - 2);
    await page.mouse.down();
    await page.mouse.move(x, bottom - height, { steps: 6 });
    await page.mouse.up();
  }
  await closePanel(demo);
}

/**
 * Off camera: show the Explorer `width` px wide with its file tree and Outline
 * sections open or folded; `outlineTop` moves the Outline's header to that y.
 */
export async function explorerLayout(
  demo: Demo,
  layout: { files: boolean; outline: boolean; width?: number; outlineTop?: number },
): Promise<void> {
  // Let the Explorer pick up files the scene just wrote before folding it.
  await demo.pause(1200);
  await showExplorer(demo, layout.width ?? 340);
  const headers = demo.page.locator('.part.sidebar .pane-header');
  const set = async (header: Locator, open: boolean) => {
    await header.waitFor({ timeout: 15_000 });
    if (((await header.getAttribute('aria-expanded')) === 'true') !== open) {
      await header.click({ position: { x: 60, y: 10 } });
      await demo.pause(300);
    }
  };
  await set(headers.first(), layout.files);
  const outline = headers.filter({ hasText: /^Outline/ }).first();
  await set(outline, layout.outline);
  const box = layout.outlineTop === undefined ? null : await outline.boundingBox();
  if (box && layout.outlineTop !== undefined) {
    // The sash between two sections sits on the lower one's top edge.
    const page = demo.page;
    await page.mouse.move(box.x + box.width / 2, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, layout.outlineTop, { steps: 6 });
    await page.mouse.up();
    await page.mouse.move(box.x + box.width + 300, 790);
  }
  // Only the folder of the file the scene opens unfolds (Explorer reveals it).
  if (layout.files) await demo.command('Collapse Folders in Explorer');
}

/** Off camera: close the panel (Problems, Output, terminal) if it is open. */
export async function closePanel(demo: Demo): Promise<void> {
  if (await demo.page.locator('.part.panel').isVisible().catch(() => false)) {
    // Toggle Panel Visibility: Ctrl+J, or Cmd+J on macOS.
    await demo.page.keyboard.press('ControlOrMeta+J');
    await demo.page.locator('.part.panel').waitFor({ state: 'hidden', timeout: 5000 });
  }
}

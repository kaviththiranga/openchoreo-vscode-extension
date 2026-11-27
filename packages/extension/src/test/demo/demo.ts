// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

// Scene callbacks passed to page.evaluate run in the workbench window.
/// <reference lib="dom" />

/**
 * Helpers for demo scenes: drive the VS Code workbench through Playwright,
 * take screenshots and record each scene to MP4 for promotional footage.
 */
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { CDPSession, ElectronApplication, Locator, Page } from 'playwright-core';

/**
 * What a scene needs beyond VS Code: `cluster` (the occ login), `workspace` (DEMO_WORKSPACE is a
 * folder made by demo/seed/workspaces-<area>.sh), `gitops-workspace` (a Flux-synced GitOps clone),
 * `copilot` (a signed-in profile), `manual` (a person at the window).
 */
export type Requirement = 'cluster' | 'workspace' | 'copilot' | 'manual' | 'gitops-workspace';

export interface Scene {
  name: string;
  /** One line describing the footage, written to the capture index. */
  title: string;
  /** Scenes needing a live cluster, a signed-in Copilot or a person at the window run only when DEMO_WITH lists them. */
  requires?: Requirement[];
  /** Runs off camera before recording starts: open views, expand trees, reset cluster state. */
  setup?(demo: Demo): Promise<void>;
  run(demo: Demo): Promise<void>;
  /** Runs off camera after recording stops, also when `run` failed: undo what the scene changed. */
  teardown?(demo: Demo): Promise<void>;
}

export interface DemoOptions {
  outDir: string;
  videoWidth: number;
  fps: number;
  keycast: boolean;
  captions: boolean;
}

/** A moment in the clip: seconds from its first frame, and the element involved in 0..1 of the frame. */
export interface Mark {
  label: string;
  t: number;
  box?: { x: number; y: number; w: number; h: number };
}

/**
 * A stretch of the clip where a popup the viewer must read is on screen: a context menu, the
 * command palette or a picker, a dialog, completions, a hover, a toast. Post-production plays
 * these at (near) real speed and frames them.
 */
export interface Overlay {
  kind: 'menu' | 'quick-input' | 'dialog' | 'suggest' | 'hover' | 'toast';
  from: number;
  to: number;
  box: { x: number; y: number; w: number; h: number };
}

/** Runs in the workbench: the popups on screen now, with their boxes in 0..1 of the window. */
function visibleOverlays(): { kind: Overlay['kind']; box: Overlay['box'] }[] {
  const W = innerWidth;
  const H = innerHeight;
  const out: { kind: Overlay['kind']; box: Overlay['box'] }[] = [];
  const add = (kind: Overlay['kind'], el: Element | null) => {
    if (!el || el.getClientRects().length === 0) return;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;
    out.push({ kind, box: { x: r.left / W, y: r.top / H, w: r.width / W, h: r.height / H } });
  };
  add('menu', document.querySelector('.context-view .monaco-menu'));
  add('quick-input', document.querySelector('.quick-input-widget'));
  add('dialog', document.querySelector('.monaco-dialog-box'));
  add('suggest', document.querySelector('.editor-widget.suggest-widget.visible'));
  add('hover', document.querySelector('.monaco-hover:not(.hidden), .workbench-hover-container .workbench-hover'));
  add('toast', document.querySelector('.notifications-toasts .notification-toast'));
  return out;
}

export class Demo {
  private shots = 0;
  readonly captures: string[] = [];
  readonly marks: Mark[] = [];

  constructor(
    readonly app: ElectronApplication,
    readonly page: Page,
    private readonly scene: Scene,
    private readonly options: DemoOptions,
    /** Seconds since the recording's first frame; undefined off camera. */
    private readonly clock: () => number | undefined = () => undefined,
  ) {}

  async pause(ms = 800): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  /**
   * Note a moment for post-production. `key` is the scene's key moment (the
   * last one wins); pass the element that shows it so the editor can zoom there.
   */
  async mark(label: string, target?: Locator): Promise<void> {
    const t = this.clock();
    if (t === undefined) return;
    let box: Mark['box'];
    const rect = await target?.boundingBox().catch(() => null);
    if (rect) {
      const [vw, vh] = await this.page.evaluate(() => [innerWidth, innerHeight]);
      box = { x: rect.x / vw, y: rect.y / vh, w: rect.width / vw, h: rect.height / vh };
    }
    this.marks.push({ label, t: Math.round(t * 100) / 100, ...(box ? { box } : {}) });
  }

  /** Save a PNG at the window's device scale (2x by default). */
  async screenshot(label: string): Promise<void> {
    this.shots += 1;
    const file = `${this.scene.name}-${String(this.shots).padStart(2, '0')}-${label}.png`;
    await this.mark(`shot:${label}`);
    // A keycast still on screen would cover what the still is about.
    await this.page.evaluate(() => document.getElementById('oc-demo-keycast')?.remove());
    await this.page.screenshot({ path: path.join(this.options.outDir, file) });
    this.captures.push(file);
  }

  /**
   * Press a key chord, showing it in the keycast overlay. `Mod` is Cmd on
   * macOS and Ctrl elsewhere (`Mod+S` saves on both).
   */
  async press(keys: string): Promise<void> {
    const chord = keys.replace(/\bMod\+/g, 'ControlOrMeta+');
    if (this.options.keycast) await this.overlay('keycast', prettyKeys(chord), 1400);
    await this.page.keyboard.press(chord);
  }

  async type(text: string, delay = 55): Promise<void> {
    await this.page.keyboard.type(text, { delay });
  }

  /**
   * Run a command from the palette by its visible title, e.g. "MCP: List Servers".
   * When the top entry isn't that command (it is hidden because its precondition
   * doesn't hold), closes the palette instead of running the closest match and returns false.
   */
  async command(title: string): Promise<boolean> {
    await this.openPalette();
    await this.pause(300);
    await this.type(title, 35);
    await this.pause(600);
    const top = this.page.locator('.quick-input-widget .quick-input-list .monaco-list-row.focused').first();
    const label = (await top.waitFor({ timeout: 5000 }).then(() => top.innerText(), () => '')).replace(/\s+/g, ' ').toLowerCase();
    if (!label.includes(title.replace(/\s+/g, ' ').toLowerCase())) {
      console.warn(`  command "${title}" is not available (top entry: "${label.split('\n')[0]}"); skipped`);
      await this.page.keyboard.press('Escape');
      return false;
    }
    await this.page.keyboard.press('Enter');
    return true;
  }

  /**
   * Open the command palette. A focused webview (a Markdown preview, the sidebar)
   * keeps F1 to itself on macOS: then hand focus back to the workbench (a click on
   * the empty middle of the status bar) and retry.
   */
  private async openPalette(): Promise<void> {
    const input = this.page.locator('.quick-input-widget input');
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.press('F1');
      if (await input.waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false)) return;
      const bar = await this.page.locator('.part.statusbar').first().boundingBox();
      if (bar) await this.page.mouse.click(bar.x + bar.width / 2, bar.y + bar.height / 2);
      await this.pause(300);
    }
    throw new Error('the command palette did not open');
  }

  /** Open a workspace file through Quick Open. */
  async openFile(name: string): Promise<void> {
    await this.press('Mod+P');
    await this.pause(300);
    await this.type(name);
    await this.pause(500);
    await this.page.keyboard.press('Enter');
    await this.pause(1200);
  }

  /** Move the cursor to `line:column` (1-based) with Go to Line. */
  async goTo(line: number, column = 1): Promise<void> {
    await this.page.keyboard.press('Control+G');
    await this.pause(200);
    await this.type(`${line}:${column}`, 30);
    await this.page.keyboard.press('Enter');
    await this.pause(300);
  }

  /** Glide the visible cursor to an element, then click it (`button: 'right'` for a context menu). */
  async click(target: Locator, options: { button?: 'left' | 'right' } = {}): Promise<void> {
    const box = await target.boundingBox();
    if (!box) throw new Error('click target is not visible');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await this.page.evaluate(
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
    await this.pause(500);
    await this.mark('click', target);
    await this.page.mouse.click(x, y, { button: options.button ?? 'left' });
  }

  /** Show a lower-third caption (only with DEMO_CAPTIONS=1; editors usually add their own). */
  async caption(text: string, ms = 2500): Promise<void> {
    if (this.options.captions) await this.overlay('caption', text, ms);
  }

  private async overlay(kind: 'keycast' | 'caption', text: string, ms: number): Promise<void> {
    await this.page.evaluate(
      ([k, t, duration]) => {
        const id = `oc-demo-${k}`;
        document.getElementById(id)?.remove();
        const el = document.createElement('div');
        el.id = id;
        el.textContent = t as string;
        Object.assign(el.style, {
          position: 'fixed', left: '50%', transform: 'translateX(-50%)', zIndex: '100000',
          bottom: k === 'keycast' ? '64px' : '120px', padding: k === 'keycast' ? '8px 18px' : '14px 28px',
          borderRadius: '10px', background: 'rgba(20, 20, 24, 0.88)', color: '#fff',
          font: k === 'keycast' ? '600 20px system-ui' : '600 26px system-ui', pointerEvents: 'none',
          boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
        });
        document.body.appendChild(el);
        setTimeout(() => el.remove(), duration as number);
      },
      [kind, text, ms] as const,
    );
  }
}

function prettyKeys(keys: string): string {
  const mac = process.platform === 'darwin';
  const named = keys
    .replace(/ControlOrMeta/g, mac ? '⌘' : 'Ctrl')
    .replace(/Control/g, mac ? '⌃' : 'Ctrl')
    .replace(/Meta/g, '⌘')
    .replace(/Shift/g, mac ? '⇧' : 'Shift')
    .replace(/Alt/g, mac ? '⌥' : 'Alt');
  return mac ? named.replace(/\+/g, ' ') : named.replace(/\+/g, ' + ');
}

/**
 * Records the page to MP4 through the DevTools screencast. The screencast only
 * sends frames when the page changes, so the last frame is re-sent at a fixed
 * rate to keep real-time pacing. Playwright's own recordVideo hangs on VS Code
 * under headless Ozone.
 */
export class Recorder {
  private ffmpeg: ChildProcess | undefined;
  private cdp: CDPSession | undefined;
  private timer: NodeJS.Timeout | undefined;
  private lastFrame: Buffer | undefined;
  private firstFrameAt: number | undefined;
  private written = 0;
  private fps = 30;
  private polling = false;
  private open = new Map<Overlay['kind'], Overlay>();
  readonly overlays: Overlay[] = [];

  /** The time in the clip: frames written so far over the frame rate. */
  elapsed(): number | undefined {
    return this.firstFrameAt === undefined ? undefined : this.written / this.fps;
  }

  static available(): boolean {
    try {
      return require('child_process').spawnSync('ffmpeg', ['-version']).status === 0;
    } catch {
      return false;
    }
  }

  async start(page: Page, file: string, options: DemoOptions): Promise<void> {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.ffmpeg = spawn('ffmpeg', [
      '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(options.fps), '-i', '-',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'veryfast',
      '-crf', '18', '-pix_fmt', 'yuv420p', file,
    ], { stdio: ['pipe', 'ignore', 'inherit'] });
    this.cdp = await page.context().newCDPSession(page);
    this.cdp.on('Page.screencastFrame', (frame) => {
      this.lastFrame = Buffer.from(frame.data, 'base64');
      void this.cdp?.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
    });
    const viewport = await page.evaluate(() => [innerWidth, innerHeight]);
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 92,
      maxWidth: options.videoWidth,
      maxHeight: Math.round((options.videoWidth * viewport[1]) / viewport[0]),
    });
    this.fps = options.fps;
    this.written = 0;
    // Timers fire late on a loaded machine; write as many frames as are due so
    // the clip keeps real-time length and marks line up with the video.
    this.polling = true;
    void this.pollOverlays(page);
    this.timer = setInterval(() => {
      if (!this.lastFrame) return;
      this.firstFrameAt ??= Date.now();
      const due = Math.floor(((Date.now() - this.firstFrameAt) / 1000) * options.fps) + 1;
      for (; this.written < due; this.written++) this.ffmpeg?.stdin?.write(this.lastFrame);
    }, 1000 / options.fps);
  }

  /** Note which popups are on screen, ~8 times a second, as stretches of the clip. */
  private async pollOverlays(page: Page): Promise<void> {
    while (this.polling) {
      const t = this.elapsed();
      if (t !== undefined) {
        const seen = await page.evaluate(visibleOverlays).catch(() => []);
        const now = Math.round(t * 100) / 100;
        for (const { kind, box } of seen) {
          const current = this.open.get(kind);
          if (current) current.to = now;
          else {
            const o: Overlay = { kind, from: now, to: now, box };
            this.open.set(kind, o);
            this.overlays.push(o);
          }
        }
        for (const kind of [...this.open.keys()]) if (!seen.some((o) => o.kind === kind)) this.open.delete(kind);
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }

  async stop(): Promise<void> {
    this.polling = false;
    if (this.timer) clearInterval(this.timer);
    await this.cdp?.send('Page.stopScreencast').catch(() => {});
    await this.cdp?.detach().catch(() => {});
    const ffmpeg = this.ffmpeg;
    if (!ffmpeg) return;
    ffmpeg.stdin?.end();
    await new Promise((resolve) => ffmpeg.on('close', resolve));
  }
}

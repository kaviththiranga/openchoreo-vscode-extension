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

export type Requirement = 'cluster' | 'copilot';

export interface Scene {
  name: string;
  /** One line describing the footage, written to the capture index. */
  title: string;
  /** Scenes needing a live cluster or a signed-in Copilot run only when DEMO_WITH lists them. */
  requires?: Requirement[];
  run(demo: Demo): Promise<void>;
}

export interface DemoOptions {
  outDir: string;
  videoWidth: number;
  fps: number;
  keycast: boolean;
  captions: boolean;
}

export class Demo {
  private shots = 0;
  readonly captures: string[] = [];

  constructor(
    readonly app: ElectronApplication,
    readonly page: Page,
    private readonly scene: Scene,
    private readonly options: DemoOptions,
  ) {}

  async pause(ms = 800): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  /** Save a PNG at the window's device scale (2x by default). */
  async screenshot(label: string): Promise<void> {
    this.shots += 1;
    const file = `${this.scene.name}-${String(this.shots).padStart(2, '0')}-${label}.png`;
    await this.page.screenshot({ path: path.join(this.options.outDir, file) });
    this.captures.push(file);
  }

  /** Press a key chord, showing it in the keycast overlay. */
  async press(keys: string): Promise<void> {
    if (this.options.keycast) await this.overlay('keycast', prettyKeys(keys), 1400);
    await this.page.keyboard.press(keys);
  }

  async type(text: string, delay = 55): Promise<void> {
    await this.page.keyboard.type(text, { delay });
  }

  /** Run a command from the palette by its visible title, e.g. "MCP: List Servers". */
  async command(title: string): Promise<void> {
    await this.press('F1');
    await this.pause(300);
    await this.type(title, 35);
    await this.pause(600);
    await this.page.keyboard.press('Enter');
  }

  /** Open a workspace file through Quick Open. */
  async openFile(name: string): Promise<void> {
    await this.press('Control+P');
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

  /** Glide the visible cursor to an element, then click it. */
  async click(target: Locator): Promise<void> {
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
    await this.page.mouse.click(x, y);
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
  return keys.replace(/Control/g, 'Ctrl').replace(/\+/g, ' + ');
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
    this.timer = setInterval(() => {
      if (this.lastFrame) this.ffmpeg?.stdin?.write(this.lastFrame);
    }, 1000 / options.fps);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.cdp?.send('Page.stopScreencast').catch(() => {});
    await this.cdp?.detach().catch(() => {});
    const ffmpeg = this.ffmpeg;
    if (!ffmpeg) return;
    ffmpeg.stdin?.end();
    await new Promise((resolve) => ffmpeg.on('close', resolve));
  }
}

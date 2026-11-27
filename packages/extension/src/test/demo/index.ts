// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Demo capture entry point, bundled and called by scripts/capture-demo.mjs.
 * Add a scene to its area's list in scenes/<area>/index.ts to capture it.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ElectronApplication, Page } from 'playwright-core';
import { Demo, Recorder, type DemoOptions, type Requirement, type Scene } from './demo';
import { aiScenes } from './scenes/ai';
import { deliveryScenes } from './scenes/delivery';
import { exploreScenes } from './scenes/explore';
import { gitopsScenes } from './scenes/gitops';
import { innerLoopScenes } from './scenes/innerloop';
import { languageScenes } from './scenes/language';
import { manual } from './scenes/manual';

/** Each feature area keeps its scenes in scenes/<area>/index.ts. */
export const SCENES: Scene[] = [
  ...exploreScenes,
  ...languageScenes,
  ...deliveryScenes,
  ...innerLoopScenes,
  ...gitopsScenes,
  ...aiScenes,
  manual,
];

// Scene names name the clips: a name used twice would overwrite another area's footage.
const duplicates = SCENES.map((s) => s.name).filter((name, i, all) => all.indexOf(name) !== i);
if (duplicates.length > 0) throw new Error(`Duplicate demo scene names: ${[...new Set(duplicates)].join(', ')}`);

export interface RunOptions extends DemoOptions {
  only: string[];
  available: Requirement[];
}

export async function runScenes(app: ElectronApplication, page: Page, options: RunOptions): Promise<boolean> {
  const record = Recorder.available();
  if (!record) console.warn('ffmpeg not found: taking screenshots only.');
  const index: string[] = ['# Demo captures', ''];
  let ok = true;

  for (const scene of SCENES) {
    if (options.only.length > 0 && !options.only.includes(scene.name)) continue;
    const missing = (scene.requires ?? []).filter((r) => !options.available.includes(r));
    if (missing.length > 0) {
      console.log(`- ${scene.name}: skipped (needs ${missing.join(', ')}; set DEMO_WITH)`);
      continue;
    }
    const offCamera = new Demo(app, page, scene, { ...options, keycast: false });
    await page.keyboard.press('Escape');
    // Off camera: start from an empty editor area without toasts such as the first-run MCP hint.
    await offCamera.command('View: Close All Editors');
    await offCamera.pause(300);
    await offCamera.command('Notifications: Clear All Notifications');
    await page.evaluate(() => document.getElementById('oc-demo-cursor')?.remove());
    await offCamera.pause(500);
    try {
      await scene.setup?.(offCamera);
      await page.evaluate(() => document.getElementById('oc-demo-cursor')?.remove());
    } catch (err) {
      ok = false;
      console.error(`- ${scene.name}: SETUP FAILED: ${err instanceof Error ? err.message : err}`);
      await offCamera.screenshot('setup-failure').catch(() => {});
      continue;
    }

    const recorder = new Recorder();
    const demo = new Demo(app, page, scene, options, () => recorder.elapsed());
    const video = `${scene.name}.mp4`;
    if (record) await recorder.start(page, path.join(options.outDir, video), options);
    try {
      await demo.pause(500);
      await scene.run(demo);
      await demo.pause(500);
      const key = demo.marks.filter((m) => m.label === 'key').pop();
      fs.writeFileSync(path.join(options.outDir, `${scene.name}.json`), JSON.stringify({
        ...(key ? { key_moment_s: key.t } : {}),
        duration_s: recorder.elapsed(),
        marks: demo.marks,
        overlays: recorder.overlays.filter((o) => o.to - o.from >= 0.1),
      }, null, 2));
      console.log(`- ${scene.name}: ok`);
    } catch (err) {
      ok = false;
      console.error(`- ${scene.name}: FAILED: ${err instanceof Error ? err.message : err}`);
      await demo.screenshot('failure').catch(() => {});
    } finally {
      if (record) await recorder.stop();
      await scene.teardown?.(offCamera).catch((err: unknown) => {
        console.error(`- ${scene.name}: TEARDOWN FAILED: ${err instanceof Error ? err.message : err}`);
      });
    }
    index.push(`## ${scene.name}`, '', scene.title, '');
    if (record) index.push(`- video: ${video}`);
    for (const shot of demo.captures) index.push(`- screenshot: ${shot}`);
    index.push('');
  }

  fs.writeFileSync(path.join(options.outDir, 'index.md'), index.join('\n'));
  return ok;
}

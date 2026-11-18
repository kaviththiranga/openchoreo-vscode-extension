// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Demo capture entry point, bundled and called by scripts/capture-demo.mjs.
 * Add a scene to SCENES to capture it.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ElectronApplication, Page } from 'playwright-core';
import { Demo, Recorder, type DemoOptions, type Requirement, type Scene } from './demo';
import { agentFixesYaml } from './scenes/agentFixesYaml';
import { aiCustomizations } from './scenes/aiCustomizations';
import { chatTools } from './scenes/chatTools';
import { fixWithCopilot } from './scenes/fixWithCopilot';
import { debugAgainstEnv } from './scenes/debugAgainstEnv';
import { gitopsCompare } from './scenes/gitopsCompare';
import { linkedComponent } from './scenes/linkedComponent';
import { manual } from './scenes/manual';
import { otherAgents } from './scenes/otherAgents';
import { mcpServers } from './scenes/mcpServers';
import { yamlAuthoring } from './scenes/yamlAuthoring';

export const SCENES: Scene[] = [
  yamlAuthoring,
  mcpServers,
  aiCustomizations,
  fixWithCopilot,
  otherAgents,
  gitopsCompare,
  linkedComponent,
  debugAgainstEnv,
  chatTools,
  agentFixesYaml,
  manual,
];

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

    const demo = new Demo(app, page, scene, options);
    const recorder = new Recorder();
    const video = `${scene.name}.mp4`;
    if (record) await recorder.start(page, path.join(options.outDir, video), options);
    try {
      await demo.pause(500);
      await scene.run(demo);
      await demo.pause(500);
      console.log(`- ${scene.name}: ok`);
    } catch (err) {
      ok = false;
      console.error(`- ${scene.name}: FAILED: ${err instanceof Error ? err.message : err}`);
      await demo.screenshot('failure').catch(() => {});
    } finally {
      if (record) await recorder.stop();
    }
    index.push(`## ${scene.name}`, '', scene.title, '');
    if (record) index.push(`- video: ${video}`);
    for (const shot of demo.captures) index.push(`- screenshot: ${shot}`);
    index.push('');
  }

  fs.writeFileSync(path.join(options.outDir, 'index.md'), index.join('\n'));
  return ok;
}

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Captures demo footage: drives a real VS Code through the scenes in
 * src/test/demo/scenes and writes an MP4 per scene plus 2x screenshots to
 * demo-output/<timestamp>/ (see index.md there).
 *
 *   pnpm demo:capture                          # scenes that need no cluster
 *   DEMO_WITH=cluster pnpm demo:capture        # also scenes that use your occ login
 *   DEMO_SCENES=yaml-authoring pnpm demo:capture
 *
 * Copilot scenes need a signed-in VS Code: point at its profile (close that
 * VS Code first) and extensions, e.g. on macOS
 *   DEMO_WITH=cluster,copilot \
 *   DEMO_USER_DATA_DIR="$HOME/Library/Application Support/Code" \
 *   DEMO_EXTENSIONS_DIR="$HOME/.vscode/extensions" pnpm demo:capture
 *
 * DEMO_WITH=gitops-workspace (with DEMO_WORKSPACE on a throwaway sample-gitops clone) adds the GitOps authoring scene.
 * DEMO_WITH=manual DEMO_MANUAL_SECONDS=90 records 90s of you using the window,
 * for footage no scene scripts yet (needs a display).
 *
 * Other settings: DEMO_WORKSPACE (folder to open), DEMO_SIZE (window, default
 * 1600x900), DEMO_SCALE (default 2), DEMO_VIDEO_WIDTH (default 1920),
 * DEMO_KEYCAST=0, DEMO_CAPTIONS=1, VSCODE_VERSION, DEMO_VSCODE_EXECUTABLE.
 * DEMO_VSIX=<file> installs a packaged build instead of running from source,
 * so the title bar doesn't read "Extension Development Host" (use it for final footage).
 * Needs ffmpeg for video. Run `pnpm build` at the repo root first.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';
import { _electron } from 'playwright-core';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const list = (value) => (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);

for (const bundle of ['dist/extension.js', '../webview-ui/dist/webview.js']) {
  if (!fs.existsSync(path.join(extensionRoot, bundle))) {
    console.error(`Missing ${bundle} — run \`pnpm build\` at the repo root first.`);
    process.exit(1);
  }
}

const bundleFile = path.join(extensionRoot, 'out', 'demo', 'index.js');
await build({
  entryPoints: [path.join(extensionRoot, 'src', 'test', 'demo', 'index.ts')],
  outfile: bundleFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['playwright-core'],
  logLevel: 'warning',
});
const { runScenes } = createRequire(import.meta.url)(bundleFile);

const [width, height] = (env.DEMO_SIZE ?? '1600x900').split('x').map(Number);
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const outDir = path.join(extensionRoot, 'demo-output', stamp);
fs.mkdirSync(outDir, { recursive: true });

const executablePath = env.DEMO_VSCODE_EXECUTABLE
  ?? await downloadAndUnzipVSCode({ version: env.VSCODE_VERSION ?? 'stable', cachePath: path.join(extensionRoot, '.vscode-test') });

// A throwaway profile unless a real one is given. It skips the welcome page,
// tips and the chat panel so the footage starts clean.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'openchoreo-demo-'));
const userDataDir = env.DEMO_USER_DATA_DIR ?? path.join(scratch, 'user-data');
// With a throwaway profile, VS Code also gets a throwaway HOME so personal
// skills, agents and instructions (~/.claude, ~/.copilot, ~/.agents) stay out
// of the footage. The occ login is passed through openchoreo.configPath.
const occConfig = env.OCC_CONFIG ?? path.join(os.homedir(), '.openchoreo', 'config');
const launchEnv = { ...process.env };
if (!env.DEMO_USER_DATA_DIR) {
  launchEnv.HOME = path.join(scratch, 'home');
  fs.mkdirSync(launchEnv.HOME, { recursive: true });
  fs.mkdirSync(path.join(userDataDir, 'User'), { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'User', 'settings.json'), JSON.stringify({
    'workbench.startupEditor': 'none',
    'workbench.tips.enabled': false,
    'workbench.secondarySideBar.defaultVisibility': 'hidden',
    'workbench.colorTheme': 'Default Dark Modern',
    'chat.commandCenter.enabled': false,
    'editor.fontSize': 15,
    'editor.minimap.enabled': false,
    'window.commandCenter': false,
    'update.mode': 'none',
    'telemetry.telemetryLevel': 'off',
    ...(fs.existsSync(occConfig) ? { 'openchoreo.configPath': occConfig } : {}),
  }, null, 2));
}

const extensionsDir = env.DEMO_EXTENSIONS_DIR ?? path.join(scratch, 'extensions');
if (env.DEMO_VSIX) {
  const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(executablePath);
  const install = spawnSync(cli, [...cliArgs, `--extensions-dir=${extensionsDir}`, '--install-extension', path.resolve(env.DEMO_VSIX), '--force'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (install.status !== 0) {
    console.error(`Installing ${env.DEMO_VSIX} failed:\n${install.stderr || install.stdout}`);
    process.exit(1);
  }
}

const args = [
  env.DEMO_WORKSPACE ?? path.join(extensionRoot, 'test-fixtures', 'e2e-workspace'),
  ...(env.DEMO_VSIX ? [] : [`--extensionDevelopmentPath=${extensionRoot}`]),
  `--user-data-dir=${userDataDir}`,
  `--extensions-dir=${extensionsDir}`,
  `--force-device-scale-factor=${env.DEMO_SCALE ?? '2'}`,
  '--disable-workspace-trust',
  '--skip-welcome',
  '--skip-release-notes',
];
if (process.platform === 'linux' && !env.DISPLAY) args.push('--ozone-platform=headless', '--disable-gpu');

const app = await _electron.launch({ executablePath, args, env: launchEnv, timeout: 90_000 });
const vscodeProcess = app.process();
let ok = false;
try {
  const page = await workbench(app);
  // --window-size is ignored under headless Ozone; size the window from the main process.
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    for (const win of BrowserWindow.getAllWindows()) win.setContentSize(w, h);
  }, [width, height]);
  await page.waitForTimeout(4000); // let the extension activate and the language server start

  ok = await runScenes(app, page, {
    outDir,
    videoWidth: Number(env.DEMO_VIDEO_WIDTH ?? 1920),
    fps: 30,
    keycast: env.DEMO_KEYCAST !== '0',
    captions: env.DEMO_CAPTIONS === '1',
    only: list(env.DEMO_SCENES),
    available: list(env.DEMO_WITH),
  });
} finally {
  await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 15_000))]);
  if (vscodeProcess.exitCode === null) vscodeProcess.kill();
  fs.rmSync(scratch, { recursive: true, force: true });
}
console.log(`Captures in ${path.relative(process.cwd(), outDir) || outDir}`);
process.exit(ok ? 0 : 1);

/** The window that hosts the workbench (VS Code also opens hidden helper windows). */
async function workbench(electronApp) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    for (const page of electronApp.windows()) {
      if (await page.locator('.monaco-workbench').count().catch(() => 0)) return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('VS Code workbench did not appear');
}

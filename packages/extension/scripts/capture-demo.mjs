// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Captures demo footage: drives a real VS Code through the scenes in
 * src/test/demo/scenes and writes an MP4 per scene plus 2x screenshots to
 * demo-output/<timestamp>/ (see index.md there).
 *
 *   pnpm demo:capture                          # scenes that need no cluster
 *   DEMO_WITH=cluster pnpm demo:capture        # also scenes that use your occ login
 *   DEMO_SCENES=smart-completions pnpm demo:capture
 *
 * Copilot scenes need a signed-in VS Code. Use a dedicated profile that keeps
 * its sign-in but still gets the demo settings: sign in once in a manual run,
 *   DEMO_PROFILE_DIR=~/demo-ws/.vscode-copilot DEMO_WITH=manual DEMO_MANUAL_SECONDS=120 pnpm demo:capture
 * then record with it:
 *   DEMO_PROFILE_DIR=~/demo-ws/.vscode-copilot DEMO_WITH=cluster,copilot pnpm demo:capture
 * A kept profile runs with your real HOME (the sign-in lives in the OS keychain),
 * so your own skills and instructions in ~/.claude, ~/.copilot load too.
 * DEMO_USER_DATA_DIR / DEMO_EXTENSIONS_DIR use an existing profile as is (close
 * that VS Code first); no demo settings are written into it.
 *
 * DEMO_WITH=gitops-workspace (with DEMO_WORKSPACE on a throwaway sample-gitops clone) adds the GitOps authoring scene.
 * DEMO_WITH=manual DEMO_MANUAL_SECONDS=90 records 90s of you using the window,
 * for footage no scene scripts yet (needs a display).
 *
 * Other settings: DEMO_WORKSPACE (folder to open), DEMO_SIZE (window, default
 * 1440x810), DEMO_SCALE (default 2), DEMO_VIDEO_WIDTH (default 1920),
 * DEMO_FONT_SIZE (editor and terminal, default 16), DEMO_OUT_DIR (default
 * demo-output/<timestamp>), DEMO_SETTINGS (JSON merged into the profile's
 * settings), DEMO_KEYCAST=0, DEMO_CAPTIONS=1, VSCODE_VERSION, DEMO_VSCODE_EXECUTABLE.
 * Each scene also writes <scene>.json: the clip's marks (key moment, clicks,
 * screenshots) with times in clip seconds and boxes in 0..1 of the frame, for
 * zooms in post-production. Several captures can run at once.
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

// One bundle per run, so captures can run side by side.
const bundleFile = path.join(extensionRoot, 'out', 'demo', `index-${process.pid}.js`);
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
fs.rmSync(bundleFile, { force: true });

const [width, height] = (env.DEMO_SIZE ?? '1440x810').split('x').map(Number);
const fontSize = Number(env.DEMO_FONT_SIZE ?? 16);
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const outDir = env.DEMO_OUT_DIR ? path.resolve(env.DEMO_OUT_DIR) : path.join(extensionRoot, 'demo-output', `${stamp}-${process.pid}`);
fs.mkdirSync(outDir, { recursive: true });

const executablePath = env.DEMO_VSCODE_EXECUTABLE
  ?? await downloadAndUnzipVSCode({ version: env.VSCODE_VERSION ?? 'stable', cachePath: path.join(extensionRoot, '.vscode-test') });

// A throwaway profile unless a real one is given. It skips the welcome page,
// tips and the chat panel so the footage starts clean.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'openchoreo-demo-'));
const profileDir = env.DEMO_PROFILE_DIR ? path.resolve(env.DEMO_PROFILE_DIR.replace(/^~(?=\/)/, os.homedir())) : undefined;
const userDataDir = env.DEMO_USER_DATA_DIR ?? profileDir ?? path.join(scratch, 'user-data');
// With a throwaway profile, VS Code also gets a throwaway HOME so personal
// skills, agents and instructions (~/.claude, ~/.copilot, ~/.agents) stay out
// of the footage. The occ login is passed through openchoreo.configPath.
const occConfig = env.OCC_CONFIG ?? path.join(os.homedir(), '.openchoreo', 'config');
const launchEnv = { ...process.env };
const isolatedHome = !env.DEMO_USER_DATA_DIR && !profileDir;
if (isolatedHome) {
  launchEnv.HOME = path.join(scratch, 'home');
  fs.mkdirSync(launchEnv.HOME, { recursive: true });
  // A neutral prompt and git identity: the footage shows neither the host nor the real user.
  fs.writeFileSync(path.join(launchEnv.HOME, '.bashrc'), "PS1='\\[\\e[1;32m\\]➜\\[\\e[0m\\] \\[\\e[1;36m\\]\\W\\[\\e[0m\\] '\n");
  fs.writeFileSync(path.join(launchEnv.HOME, '.zshrc'), "PROMPT='%F{green}➜%f %F{cyan}%1~%f '\n");
  // Ubuntu's bashrc prints a sudo hint in every new shell until this file exists.
  fs.writeFileSync(path.join(launchEnv.HOME, '.sudo_as_admin_successful'), '');
  fs.writeFileSync(path.join(launchEnv.HOME, '.gitconfig'), '[user]\n\tname = Demo Developer\n\temail = dev@example.com\n[init]\n\tdefaultBranch = main\n');
}
if (!env.DEMO_USER_DATA_DIR) {
  fs.mkdirSync(path.join(userDataDir, 'User'), { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'User', 'settings.json'), JSON.stringify({
    'workbench.startupEditor': 'none',
    'workbench.tips.enabled': false,
    'workbench.secondarySideBar.defaultVisibility': 'hidden',
    'workbench.colorTheme': 'Default Dark Modern',
    'chat.commandCenter.enabled': false,
    'editor.fontSize': fontSize,
    'terminal.integrated.fontSize': fontSize - 1,
    'debug.console.fontSize': fontSize - 1,
    'editor.minimap.enabled': false,
    'editor.stickyScroll.enabled': false,
    'extensions.ignoreRecommendations': true,
    'git.openRepositoryInParentFolders': 'never',
    'terminal.integrated.enablePersistentSessions': false,
    // DOM-rendered terminal text, so scenes can wait on it.
    'terminal.integrated.gpuAcceleration': 'off',
    // VS Code's own file dialogs: native ones don't render headless and aren't in the recording.
    'files.simpleDialog.enable': true,
    'window.commandCenter': false,
    // Native dialogs and menus aren't in the page: they don't render under headless
    // Ozone, the screencast can't see them, and Playwright can't click them.
    'window.dialogStyle': 'custom',
    'window.menuStyle': 'custom',
    'window.titleBarStyle': 'custom',
    'update.mode': 'none',
    'telemetry.telemetryLevel': 'off',
    // Git blame shows real commit authors of cloned repositories.
    'git.blame.statusBarItem.enabled': false,
    'git.blame.editorDecoration.enabled': false,
    'workbench.view.alwaysShowHeaderActions': true,
    ...(fs.existsSync(occConfig) ? { 'openchoreo.configPath': occConfig } : {}),
    ...(env.DEMO_SETTINGS ? JSON.parse(env.DEMO_SETTINGS) : {}),
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
  // The throwaway HOME has no keychain: on macOS VS Code would wait on a hidden keychain prompt.
  ...(isolatedHome ? ['--use-inmemory-secretstorage'] : []),
];
if (process.platform === 'linux' && !env.DISPLAY) args.push('--ozone-platform=headless', '--disable-gpu');
// On a desktop the window may be covered by others; keep it rendering at full rate.
args.push('--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling');

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

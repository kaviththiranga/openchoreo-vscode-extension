// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Runs the end-to-end suite (src/test/e2e/*.e2e.ts) in a real VS Code.
 *
 *   pnpm test:e2e                      # downloads VS Code stable into .vscode-test/
 *   VSCODE_VERSION=1.99.0 pnpm test:e2e
 *   OPENCHOREO_E2E_RESOURCE=/namespaces/default/environment/development.yaml pnpm test:e2e
 *
 * Needs a display on Linux: CI wraps it in `xvfb-run -a`. Without DISPLAY it
 * falls back to Chromium's headless Ozone platform.
 * Run `pnpm build` at the repo root first (extension + webview bundles).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { runTests } from '@vscode/test-electron';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(extensionRoot, 'out', 'e2e');
const testsDir = path.join(extensionRoot, 'src', 'test', 'e2e');

for (const bundle of ['dist/extension.js', '../webview-ui/dist/webview.js']) {
  if (!fs.existsSync(path.join(extensionRoot, bundle))) {
    console.error(`Missing ${bundle} — run \`pnpm build\` at the repo root first.`);
    process.exit(1);
  }
}

fs.rmSync(outDir, { recursive: true, force: true });
await build({
  entryPoints: fs.readdirSync(testsDir).filter((f) => f.endsWith('.ts')).map((f) => path.join(testsDir, f)),
  outdir: outDir,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  sourcemap: true,
  external: ['vscode', 'mocha'],
  logLevel: 'warning',
});

// Isolated profile so the developer's settings and extensions don't leak in.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'openchoreo-e2e-'));
const launchArgs = [
  path.join(extensionRoot, 'test-fixtures', 'e2e-workspace'),
  '--disable-extensions',
  '--disable-gpu',
  '--disable-workspace-trust',
  '--skip-welcome',
  '--skip-release-notes',
  `--user-data-dir=${path.join(profile, 'user-data')}`,
  `--extensions-dir=${path.join(profile, 'extensions')}`,
];
if (process.platform === 'linux' && !process.env.DISPLAY) launchArgs.push('--ozone-platform=headless');

// The suite needs no cluster: keep it away from the developer's occ login unless
// the live checks (OPENCHOREO_E2E_RESOURCE) ask for it.
if (!process.env.OPENCHOREO_E2E_RESOURCE) {
  const userDir = path.join(profile, 'user-data', 'User');
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDir, 'settings.json'),
    JSON.stringify({ 'openchoreo.configPath': path.join(profile, 'no-occ-login', '.openchoreo', 'config') }),
  );
}

try {
  await runTests({
    version: process.env.VSCODE_VERSION ?? 'stable',
    extensionDevelopmentPath: extensionRoot,
    extensionTestsPath: path.join(outDir, 'index.js'),
    launchArgs,
  });
} catch (err) {
  console.error(`End-to-end tests failed: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(profile, { recursive: true, force: true });
}

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { managedBinaryPath, resolveOccAsset } from './manifest';

/**
 * Resolve the occ binary to invoke for `spawn(...)`.
 *
 * Precedence:
 *   1. `openchoreo.cliPath` setting (user override — wins everything)
 *   2. Managed binary at <globalStorage>/occ-cli/<version>/occ[.exe] if it
 *      exists on disk (from a successful auto-download)
 *   3. Literal "occ" — relies on the system PATH (the long-standing default)
 *
 * Pure-sync function so detector/login-runner/logout don't have to wait on
 * disk I/O on every spawn. Returns a string that's safe to pass to spawn().
 */
export function getOccBinaryPath(context: vscode.ExtensionContext): string {
  const fs = require('fs') as typeof import('fs');

  const override = vscode.workspace
    .getConfiguration('openchoreo')
    .get<string>('cliPath', '')
    .trim();
  if (override.length > 0) return override;

  const asset = resolveOccAsset(context);
  if (asset) {
    const bundled = managedBinaryPath(context, asset);
    try {
      if (fs.existsSync(bundled)) return bundled;
    } catch {
      // ignore — fall through to PATH default
    }
  }

  return 'occ';
}

/**
 * True when a managed binary for the pinned version is already on disk.
 * Used by the first-run prompt to decide whether to offer a download.
 */
export function hasManagedBinary(context: vscode.ExtensionContext): boolean {
  const fs = require('fs') as typeof import('fs');
  const asset = resolveOccAsset(context);
  if (!asset) return false;
  try {
    return fs.existsSync(managedBinaryPath(context, asset));
  } catch {
    return false;
  }
}

/**
 * Home directory overrides so occ reads the same config as the extension.
 * occ always uses `$HOME/.openchoreo/config`; when `openchoreo.configPath`
 * points at another `<home>/.openchoreo/config`, occ gets that home.
 * Returns {} when no override is needed (or the path can't be expressed so).
 */
export function occHomeOverride(configPath: string): Record<string, string> {
  const path = require('path') as typeof import('path');
  const trimmed = configPath.trim();
  if (!trimmed) return {};
  const resolved = path.resolve(trimmed);
  const dir = path.dirname(resolved);
  if (path.basename(resolved) !== 'config' || path.basename(dir) !== '.openchoreo') return {};
  const home = path.dirname(dir);
  return process.platform === 'win32' ? { USERPROFILE: home, HOME: home } : { HOME: home };
}

/** The environment for an occ process: the extension's own, with the config home override. */
export function occEnv(): NodeJS.ProcessEnv {
  const configPath = vscode.workspace.getConfiguration('openchoreo').get<string>('configPath', '') ?? '';
  return { ...process.env, ...occHomeOverride(configPath) };
}

/** Just the overrides, for terminals (which inherit the rest). */
export function occTerminalEnv(): Record<string, string> {
  return occHomeOverride(vscode.workspace.getConfiguration('openchoreo').get<string>('configPath', '') ?? '');
}

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

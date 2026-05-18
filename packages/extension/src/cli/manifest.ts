// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';

/**
 * Where the binary is expected to live after a successful download.
 * Versioned so updates ride a clean directory swap (no in-place overwrites).
 */
export interface OccAsset {
  /** Pinned occ version, e.g. "v1.0.1" (from package.json `occVersion`). */
  version: string;
  /** GitHub release asset filename (e.g. occ_v1.0.1_darwin_arm64.tar.gz). */
  assetName: string;
  /** Full URL of the asset on github.com/releases/download/<tag>/<file>. */
  assetUrl: string;
  /** Full URL of the matching checksums.txt file for SHA-256 verification. */
  checksumsUrl: string;
  /** Archive format — drives extraction strategy. */
  archive: 'tar.gz' | 'zip';
  /** Final binary filename inside the extracted archive ('occ' or 'occ.exe'). */
  binaryName: string;
}

interface TargetTriple {
  os: 'darwin' | 'linux' | 'windows';
  arch: 'amd64' | 'arm64';
}

/**
 * Detect the current Node/OS platform-arch pair. Returns undefined when the
 * combination isn't published as an occ release asset — caller falls back
 * to "install manually" UX.
 */
export function targetTriple(): TargetTriple | undefined {
  let os: TargetTriple['os'] | undefined;
  if (process.platform === 'darwin') os = 'darwin';
  else if (process.platform === 'linux') os = 'linux';
  else if (process.platform === 'win32') os = 'windows';

  let arch: TargetTriple['arch'] | undefined;
  if (process.arch === 'x64') arch = 'amd64';
  else if (process.arch === 'arm64') arch = 'arm64';

  if (!os || !arch) return undefined;
  return { os, arch };
}

/**
 * Read the pinned occ version from the extension's package.json.
 * Falls back to a sentinel if missing so the caller can show a clear error
 * instead of attempting a malformed download URL.
 */
export function readPinnedVersion(extensionPath: string): string | undefined {
  try {
    // Resolve via Node's fs since the build bundles package.json into the
    // extension dir but esbuild won't statically import it.
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const pkg = JSON.parse(
      fs.readFileSync(path.join(extensionPath, 'package.json'), 'utf-8'),
    ) as { occVersion?: string };
    return typeof pkg.occVersion === 'string' && pkg.occVersion.length > 0
      ? pkg.occVersion
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build the OccAsset descriptor for the current platform, or undefined if
 * we can't (unsupported triple or missing pinned version).
 */
export function resolveOccAsset(context: vscode.ExtensionContext): OccAsset | undefined {
  const triple = targetTriple();
  if (!triple) return undefined;
  const version = readPinnedVersion(context.extensionPath);
  if (!version) return undefined;

  const ext = triple.os === 'windows' ? 'zip' : 'tar.gz';
  const assetName = `occ_${version}_${triple.os}_${triple.arch}.${ext}`;
  const base = `https://github.com/openchoreo/openchoreo/releases/download/${version}`;
  return {
    version,
    assetName,
    assetUrl: `${base}/${assetName}`,
    checksumsUrl: `${base}/checksums.txt`,
    archive: triple.os === 'windows' ? 'zip' : 'tar.gz',
    binaryName: triple.os === 'windows' ? 'occ.exe' : 'occ',
  };
}

/**
 * Absolute path on disk where the managed binary will live after extraction.
 *
 *   <globalStorage>/occ-cli/<version>/occ[.exe]
 *
 * Version-scoped so we can keep old binaries around briefly during upgrades.
 */
export function managedBinaryPath(
  context: vscode.ExtensionContext,
  asset: Pick<OccAsset, 'version' | 'binaryName'>,
): string {
  const path = require('path') as typeof import('path');
  return path.join(
    context.globalStorageUri.fsPath,
    'occ-cli',
    asset.version,
    asset.binaryName,
  );
}

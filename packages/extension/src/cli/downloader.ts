// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as https from 'node:https';
import * as crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { log } from '../logging/logger';
import {
  managedBinaryPath,
  resolveOccAsset,
  type OccAsset,
} from './manifest';

/**
 * Reusable installer Output channel. Created lazily and re-used across
 * download attempts so the user can review prior runs.
 */
let installerChannel: vscode.OutputChannel | undefined;
function getChannel(): vscode.OutputChannel {
  installerChannel ??= vscode.window.createOutputChannel('OpenChoreo CLI Installer');
  return installerChannel;
}

export interface DownloadResult {
  status: 'installed' | 'cancelled' | 'unsupported' | 'failed';
  binaryPath?: string;
  error?: string;
}

/**
 * Top-level: confirm support, then run the progress-tracked installer.
 * Surfaces a single result for the caller (command or toast handler) to
 * report success/failure to the user.
 */
export async function downloadAndInstallOccCli(
  context: vscode.ExtensionContext,
): Promise<DownloadResult> {
  const asset = resolveOccAsset(context);
  if (!asset) {
    return {
      status: 'unsupported',
      error:
        'No occ release is published for this platform/architecture. Please install manually.',
    };
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Installing occ ${asset.version}`,
      cancellable: true,
    },
    (progress, token) => runInstall(context, asset, progress, token),
  );
}

async function runInstall(
  context: vscode.ExtensionContext,
  asset: OccAsset,
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  token: vscode.CancellationToken,
): Promise<DownloadResult> {
  const channel = getChannel();
  const versionDir = path.dirname(managedBinaryPath(context, asset));
  const downloadDir = path.join(versionDir, '.download');
  const archivePath = path.join(downloadDir, asset.assetName);
  const finalPath = managedBinaryPath(context, asset);

  channel.appendLine(`[${new Date().toISOString()}] Installing ${asset.assetName}`);
  channel.appendLine(`  source : ${asset.assetUrl}`);
  channel.appendLine(`  target : ${finalPath}`);

  try {
    await fsp.mkdir(downloadDir, { recursive: true });
  } catch (err) {
    return failed(channel, 'Could not create install directory', err);
  }

  // 1. Download the archive.
  progress.report({ message: 'Downloading...' });
  try {
    await downloadToFile(asset.assetUrl, archivePath, progress, token, channel);
  } catch (err) {
    await safeRemove(downloadDir);
    if (token.isCancellationRequested) {
      channel.appendLine('  cancelled by user');
      return { status: 'cancelled' };
    }
    return failed(channel, 'Download failed', err);
  }

  // 2. Fetch checksums.txt and verify SHA-256.
  progress.report({ message: 'Verifying checksum...' });
  try {
    const checksums = await fetchText(asset.checksumsUrl, token);
    const expected = parseChecksum(checksums, asset.assetName);
    if (!expected) {
      throw new Error(
        `No SHA-256 line for ${asset.assetName} in checksums.txt`,
      );
    }
    const actual = await sha256File(archivePath);
    if (actual !== expected) {
      throw new Error(
        `SHA-256 mismatch — expected ${expected}, got ${actual}`,
      );
    }
    channel.appendLine(`  checksum ok (${expected.slice(0, 12)}…)`);
  } catch (err) {
    await safeRemove(downloadDir);
    return failed(channel, 'Checksum verification failed', err);
  }

  // 3. Extract.
  progress.report({ message: 'Extracting...' });
  const extractDir = path.join(downloadDir, 'extracted');
  try {
    await fsp.mkdir(extractDir, { recursive: true });
    if (asset.archive === 'tar.gz') {
      await runChild('tar', ['-xzf', archivePath, '-C', extractDir], channel);
    } else {
      // Windows: use PowerShell's Expand-Archive
      await runChild(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Expand-Archive -LiteralPath "${archivePath}" -DestinationPath "${extractDir}" -Force`,
        ],
        channel,
      );
    }
  } catch (err) {
    await safeRemove(downloadDir);
    return failed(channel, 'Extraction failed', err);
  }

  // 4. Locate the extracted binary (it might be nested under a folder).
  let extractedBinary: string | undefined;
  try {
    extractedBinary = await findBinary(extractDir, asset.binaryName);
  } catch (err) {
    await safeRemove(downloadDir);
    return failed(channel, `Could not find ${asset.binaryName} in archive`, err);
  }
  if (!extractedBinary) {
    await safeRemove(downloadDir);
    return failed(
      channel,
      `Archive did not contain a binary named ${asset.binaryName}`,
    );
  }

  // 5. chmod +x on non-windows.
  if (process.platform !== 'win32') {
    try {
      await fsp.chmod(extractedBinary, 0o755);
    } catch (err) {
      channel.appendLine(`  chmod warning: ${String(err)}`);
      // Non-fatal — some filesystems (mounted), still try to run.
    }
  }

  // 6. Atomic place into final path.
  try {
    await fsp.mkdir(path.dirname(finalPath), { recursive: true });
    // Remove an existing binary at the final path if any; rename will fail
    // on Windows if the target exists.
    await safeUnlink(finalPath);
    await fsp.rename(extractedBinary, finalPath);
  } catch (err) {
    return failed(channel, 'Could not move binary into place', err);
  }

  // 7. Cleanup transient .download directory + old version directories.
  await safeRemove(downloadDir);
  await cleanupOldVersionDirs(context, asset.version);

  channel.appendLine(`  installed: ${finalPath}`);
  return { status: 'installed', binaryPath: finalPath };
}

/** Convenience: log + return a failed result. */
function failed(
  channel: vscode.OutputChannel,
  message: string,
  err?: unknown,
): DownloadResult {
  const detail = err instanceof Error ? err.message : err ? String(err) : '';
  channel.appendLine(`  ERROR: ${message}${detail ? ` — ${detail}` : ''}`);
  return { status: 'failed', error: detail ? `${message}: ${detail}` : message };
}

// ---------- HTTPS streaming download (with redirect + cancel) ----------

async function downloadToFile(
  url: string,
  destPath: string,
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  token: vscode.CancellationToken,
  channel: vscode.OutputChannel,
): Promise<void> {
  const file = fs.createWriteStream(destPath);
  const cleanup = () => {
    file.close();
    try {
      fs.unlinkSync(destPath);
    } catch {
      // ignore
    }
  };

  let redirects = 0;
  let currentUrl = url;
  while (true) {
    const response = await new Promise<import('http').IncomingMessage>(
      (resolve, reject) => {
        const req = https.get(currentUrl, resolve);
        req.on('error', reject);
        token.onCancellationRequested(() => {
          req.destroy(new Error('cancelled'));
          reject(new Error('cancelled'));
        });
      },
    );

    if (
      response.statusCode &&
      response.statusCode >= 300 &&
      response.statusCode < 400 &&
      response.headers.location
    ) {
      if (redirects++ > 5) {
        cleanup();
        throw new Error('too many redirects');
      }
      currentUrl = new URL(response.headers.location, currentUrl).toString();
      channel.appendLine(`  -> ${currentUrl}`);
      response.resume();
      continue;
    }
    if (response.statusCode !== 200) {
      cleanup();
      throw new Error(`HTTP ${response.statusCode} from ${currentUrl}`);
    }

    const total = parseInt(response.headers['content-length'] ?? '0', 10);
    let received = 0;
    let lastPctReported = 0;

    await new Promise<void>((resolve, reject) => {
      response.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (total > 0) {
          const pct = Math.floor((received / total) * 100);
          if (pct >= lastPctReported + 5) {
            progress.report({ message: `Downloading ${pct}%` });
            lastPctReported = pct;
          }
        }
      });
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
      file.on('error', (err) => {
        cleanup();
        reject(err);
      });
      token.onCancellationRequested(() => {
        response.destroy();
        cleanup();
        reject(new Error('cancelled'));
      });
    });
    return;
  }
}

// ---------- Helpers: small HTTPS GET to text, SHA-256, file ops ----------

async function fetchText(
  url: string,
  token: vscode.CancellationToken,
): Promise<string> {
  let redirects = 0;
  let currentUrl = url;
  while (true) {
    const response = await new Promise<import('http').IncomingMessage>(
      (resolve, reject) => {
        const req = https.get(currentUrl, resolve);
        req.on('error', reject);
        token.onCancellationRequested(() => {
          req.destroy(new Error('cancelled'));
          reject(new Error('cancelled'));
        });
      },
    );
    if (
      response.statusCode &&
      response.statusCode >= 300 &&
      response.statusCode < 400 &&
      response.headers.location
    ) {
      if (redirects++ > 5) throw new Error('too many redirects');
      currentUrl = new URL(response.headers.location, currentUrl).toString();
      response.resume();
      continue;
    }
    if (response.statusCode !== 200) {
      throw new Error(`HTTP ${response.statusCode} from ${currentUrl}`);
    }
    const chunks: Buffer[] = [];
    return new Promise<string>((resolve, reject) => {
      response.on('data', (c: Buffer) => chunks.push(c));
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      response.on('error', reject);
    });
  }
}

/** Find the SHA-256 hex for a given filename in a goreleaser-style checksums.txt. */
function parseChecksum(text: string, assetName: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const [hash, name] = parts;
    if (name === assetName || name === `*${assetName}`) {
      return hash.toLowerCase();
    }
  }
  return undefined;
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function runChild(
  command: string,
  args: string[],
  channel: vscode.OutputChannel,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    child.on('error', (err) => reject(err));
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const detail = stderr.trim().slice(-500);
        channel.appendLine(`  ${command} exit ${code}: ${detail}`);
        reject(new Error(`${command} exited ${code}: ${detail}`));
      }
    });
  });
}

/** Recursively scan a directory tree for a file matching binaryName. */
async function findBinary(
  root: string,
  binaryName: string,
): Promise<string | undefined> {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && entry.name === binaryName) return full;
    if (entry.isDirectory()) {
      const nested = await findBinary(full, binaryName);
      if (nested) return nested;
    }
  }
  return undefined;
}

async function safeRemove(p: string): Promise<void> {
  try {
    await fsp.rm(p, { recursive: true, force: true });
  } catch (err) {
    log.debug(`safeRemove(${p}) failed: ${String(err)}`);
  }
}

async function safeUnlink(p: string): Promise<void> {
  try {
    await fsp.unlink(p);
  } catch {
    // ignore — most likely doesn't exist
  }
}

/**
 * Remove version directories under .../occ-cli/ that don't match the
 * version we just installed. Best-effort — failures just leave extra files.
 */
async function cleanupOldVersionDirs(
  context: vscode.ExtensionContext,
  keepVersion: string,
): Promise<void> {
  const root = path.join(context.globalStorageUri.fsPath, 'occ-cli');
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== keepVersion) {
      await safeRemove(path.join(root, entry.name));
    }
  }
}

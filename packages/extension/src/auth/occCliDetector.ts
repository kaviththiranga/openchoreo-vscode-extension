// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'child_process';
import { log } from '../logging/logger';

/**
 * Detects whether the `occ` CLI is available on $PATH.
 *
 * Spawns `occ version` with a short timeout. On ENOENT (binary not found)
 * the detector reports `installed: false` so the sidebar can guide the user
 * to the install docs. The result is cached until `recheck()` is called.
 */
export interface OccCliInfo {
  installed: boolean;
  /** Short display string like "occ 1.0.0" — parsed from `occ version`. */
  version?: string;
  /** Full raw stdout from `occ version` — used as a tooltip in the sidebar. */
  versionDetails?: string;
}

const DETECT_TIMEOUT_MS = 3000;

/**
 * Parse `occ version` output to extract the client version.
 *
 * Expected format:
 *   Client:
 *     Version:      1.0.0
 *     Git Revision: ...
 *   Server:
 *     Version:      1.0.0
 *     ...
 *
 * Returns a short display string like "occ 1.0.0", or undefined if the
 * format is unexpected (older builds may differ).
 */
function parseOccVersion(stdout: string): string | undefined {
  const lines = stdout.split('\n');
  let inClientBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'Client:') {
      inClientBlock = true;
      continue;
    }
    if (inClientBlock) {
      // "Version:      1.0.0"
      const match = /^Version:\s*(\S+)/.exec(trimmed);
      if (match) return `occ ${match[1]}`;
      // Another top-level section (e.g. "Server:") — stop looking.
      if (trimmed.endsWith(':') && !trimmed.startsWith(' ')) break;
    }
  }
  // Fallback: try to find *any* semver-ish token in the output.
  const fallback = /\b\d+\.\d+\.\d+\S*/.exec(stdout);
  return fallback ? `occ ${fallback[0]}` : undefined;
}

export class OccCliDetector {
  private cached: OccCliInfo | undefined;
  private inflight: Promise<OccCliInfo> | undefined;

  /**
   * Return the cached CLI status, detecting on first call.
   */
  async get(): Promise<OccCliInfo> {
    if (this.cached) return this.cached;
    if (this.inflight) return this.inflight;
    this.inflight = this.detect().then((info) => {
      this.cached = info;
      this.inflight = undefined;
      return info;
    });
    return this.inflight;
  }

  /**
   * Force a fresh detection — call this after the user clicks
   * "I've installed it" in the sidebar.
   */
  async recheck(): Promise<OccCliInfo> {
    this.cached = undefined;
    this.inflight = undefined;
    return this.get();
  }

  private detect(): Promise<OccCliInfo> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (info: OccCliInfo) => {
        if (settled) return;
        settled = true;
        resolve(info);
      };

      let child: ReturnType<typeof spawn>;
      try {
        child = spawn('occ', ['version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        log.debug(`occ version spawn threw synchronously: ${String(err)}`);
        done({ installed: false });
        return;
      }

      let stdout = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      const timer = setTimeout(() => {
        child.kill();
        log.debug('occ version detection timed out');
        done({ installed: false });
      }, DETECT_TIMEOUT_MS);

      child.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (err.code === 'ENOENT') {
          log.debug('occ CLI not found on $PATH');
        } else {
          log.debug(`occ version errored: ${err.message}`);
        }
        done({ installed: false });
      });

      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          done({
            installed: true,
            version: parseOccVersion(stdout),
            versionDetails: stdout.trim() || undefined,
          });
        } else {
          // Binary exists but version command failed — still treat as installed
          // (may be an older build without `version` subcommand).
          done({ installed: true });
        }
      });
    });
  }
}

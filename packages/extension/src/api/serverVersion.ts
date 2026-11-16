// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Parsed OpenChoreo control-plane version, from GET /version
 * (e.g. "1.3.3", "v1.4.0-m.2", "latest-dev").
 */
export interface ServerVersion {
  /** Raw version string as reported by the server. */
  raw: string;
  major: number;
  minor: number;
  patch: number;
  /** Pre-release suffix such as "m.2" or "rc.1", if any. */
  prerelease?: string;
  /** True for builds that carry no release number (e.g. "latest-dev"). */
  dev: boolean;
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/;

export function parseServerVersion(raw: string | undefined): ServerVersion | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const match = VERSION_PATTERN.exec(trimmed);
  if (!match) {
    // Source builds report a non-numeric version; treat them as newest.
    return { raw: trimmed, major: 0, minor: 0, patch: 0, dev: true };
  }
  return {
    raw: trimmed,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
    dev: false,
  };
}

/**
 * True when the server is at least `major.minor`. Pre-releases count as their
 * target line (1.4.0-m.2 satisfies 1.4) and dev builds satisfy everything, so
 * features land on milestones and source builds as soon as they exist there.
 * Unknown versions return `fallback`.
 */
export function isAtLeast(
  version: ServerVersion | undefined,
  major: number,
  minor: number,
  fallback = false,
): boolean {
  if (!version) return fallback;
  if (version.dev) return true;
  if (version.major !== major) return version.major > major;
  return version.minor >= minor;
}

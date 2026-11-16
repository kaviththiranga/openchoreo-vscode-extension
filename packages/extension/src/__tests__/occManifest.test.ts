// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { buildOccAsset, targetTriple } from '../cli/manifest';
import { parseChecksum } from '../cli/downloader';

describe('targetTriple', () => {
  it('maps node platform/arch to release asset names', () => {
    expect(targetTriple('darwin', 'arm64')).toEqual({ os: 'darwin', arch: 'arm64' });
    expect(targetTriple('linux', 'x64')).toEqual({ os: 'linux', arch: 'amd64' });
  });

  it('has no asset for windows or unsupported arches', () => {
    expect(targetTriple('win32', 'x64')).toBeUndefined();
    expect(targetTriple('linux', 'ia32')).toBeUndefined();
  });
});

describe('buildOccAsset', () => {
  it('follows the goreleaser naming used by OpenChoreo releases', () => {
    const asset = buildOccAsset('v1.3.3', { os: 'linux', arch: 'amd64' });
    expect(asset.assetName).toBe('occ_v1.3.3_linux_amd64.tar.gz');
    expect(asset.assetUrl).toBe(
      'https://github.com/openchoreo/openchoreo/releases/download/v1.3.3/occ_v1.3.3_linux_amd64.tar.gz',
    );
    expect(asset.checksumsUrl).toBe(
      'https://github.com/openchoreo/openchoreo/releases/download/v1.3.3/checksums.txt',
    );
    expect(asset.binaryName).toBe('occ');
  });
});

describe('parseChecksum', () => {
  const checksums = [
    'ABC123  occ_v1.3.3_darwin_arm64.tar.gz',
    'def456 *occ_v1.3.3_linux_amd64.tar.gz',
    '',
  ].join('\n');

  it('finds the hash for an asset, lowercased, with or without the binary-mode marker', () => {
    expect(parseChecksum(checksums, 'occ_v1.3.3_darwin_arm64.tar.gz')).toBe('abc123');
    expect(parseChecksum(checksums, 'occ_v1.3.3_linux_amd64.tar.gz')).toBe('def456');
  });

  it('returns undefined when the asset is not listed', () => {
    expect(parseChecksum(checksums, 'occ_v1.3.3_linux_arm64.tar.gz')).toBeUndefined();
  });
});

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { isAtLeast, parseServerVersion } from '../api/serverVersion';

describe('parseServerVersion', () => {
  it('parses GA and milestone versions with or without a v prefix', () => {
    expect(parseServerVersion('1.3.3')).toMatchObject({ major: 1, minor: 3, patch: 3, dev: false });
    expect(parseServerVersion('v1.4.0-m.2')).toMatchObject({
      major: 1,
      minor: 4,
      patch: 0,
      prerelease: 'm.2',
    });
  });

  it('treats non-numeric source builds as dev', () => {
    expect(parseServerVersion('latest-dev')).toMatchObject({ dev: true, raw: 'latest-dev' });
  });

  it('returns undefined for missing input', () => {
    expect(parseServerVersion(undefined)).toBeUndefined();
    expect(parseServerVersion('')).toBeUndefined();
  });
});

describe('isAtLeast', () => {
  it('compares major and minor', () => {
    const v13 = parseServerVersion('1.3.3');
    expect(isAtLeast(v13, 1, 3)).toBe(true);
    expect(isAtLeast(v13, 1, 4)).toBe(false);
    expect(isAtLeast(v13, 1, 2)).toBe(true);
    expect(isAtLeast(parseServerVersion('2.0.0'), 1, 9)).toBe(true);
  });

  it('counts milestones as their target line and dev builds as newest', () => {
    expect(isAtLeast(parseServerVersion('1.4.0-m.1'), 1, 4)).toBe(true);
    expect(isAtLeast(parseServerVersion('latest-dev'), 9, 9)).toBe(true);
  });

  it('uses the fallback when the version is unknown', () => {
    expect(isAtLeast(undefined, 1, 4)).toBe(false);
    expect(isAtLeast(undefined, 1, 4, true)).toBe(true);
  });
});

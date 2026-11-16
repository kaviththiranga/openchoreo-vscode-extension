// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { shellQuote } from '../commands/devLoopCommands';

describe('shellQuote', () => {
  it('leaves plain arguments alone', () => {
    expect(shellQuote('component')).toBe('component');
    expect(shellQuote('.openchoreo/workload.yaml')).toBe('.openchoreo/workload.yaml');
    expect(shellQuote('--env')).toBe('--env');
  });

  it('quotes paths with spaces and embedded quotes', () => {
    expect(shellQuote('/Users/me/Application Support/occ')).toBe(`'/Users/me/Application Support/occ'`);
    expect(shellQuote(`it's`)).toBe(`'it'\\''s'`);
  });
});

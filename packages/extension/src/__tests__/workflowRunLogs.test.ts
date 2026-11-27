// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { newRunName, sortByTimestamp } from '../services/workflowRunService';

describe('sortByTimestamp', () => {
  it('orders logs grouped by step by time, nanoseconds included', () => {
    const logs = [
      { timestamp: '2026-11-26T23:06:40.5Z', log: 'build 2' },
      { timestamp: '2026-11-26T23:06:39.945159459Z', log: 'build 1' },
      { timestamp: '2026-11-26T23:06:39.9Z', log: 'checkout 2' },
      { timestamp: '2026-11-26T23:06:39.10Z', log: 'checkout 1' },
      { timestamp: '2026-11-26T23:06:41Z', log: 'publish' },
    ];
    expect(sortByTimestamp(logs).map((e) => e.log)).toEqual(['checkout 1', 'checkout 2', 'build 1', 'build 2', 'publish']);
  });

  it('keeps the order of equal timestamps and of entries without one', () => {
    const same = [{ timestamp: '2026-11-26T23:06:39Z', log: 'a' }, { timestamp: '2026-11-26T23:06:39Z', log: 'b' }];
    expect(sortByTimestamp(same).map((e) => e.log)).toEqual(['a', 'b']);
    const partial = [{ timestamp: '2026-11-26T23:06:40Z', log: 'a' }, { log: 'b' }, { timestamp: '2026-11-26T23:06:39Z', log: 'c' }];
    expect(sortByTimestamp(partial)).toBe(partial);
  });

  it('compares across time zone offsets', () => {
    const logs = [{ timestamp: '2026-11-26T23:30:00+05:30', log: 'later' }, { timestamp: '2026-11-26T17:00:00Z', log: 'earlier' }];
    expect(sortByTimestamp(logs).map((e) => e.log)).toEqual(['earlier', 'later']);
  });
});

describe('newRunName', () => {
  it('adds a short suffix that sorts later runs after earlier ones', () => {
    const first = newRunName('greeter', Date.parse('2026-11-27T06:00:00Z'));
    const second = newRunName('greeter', Date.parse('2026-11-27T06:00:01Z'));
    expect(first).toMatch(/^greeter-[0-9a-z]{8}$/);
    expect(second > first).toBe(true);
  });
});

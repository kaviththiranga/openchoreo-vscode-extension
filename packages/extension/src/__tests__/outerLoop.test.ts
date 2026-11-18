// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { isPush } from '../workspace/componentLinks';
import { findRunForCommit, parametersForCommit, runOutcome } from '../workspace/builds';
import { cloneDirName } from '../workspace/cloneSource';

const paths = { url: 'repository.url', branch: 'repository.revision.branch', commit: 'repository.revision.commit' };

describe('push detection', () => {
  const head = { branch: 'main', commit: 'abc', hasUpstream: true };
  it('sees commits leave "ahead" on the same commit', () => {
    expect(isPush({ ...head, ahead: 2 }, { ...head, ahead: 0 })).toBe(true);
  });
  it('sees a first push that sets the upstream', () => {
    expect(isPush({ branch: 'feat', commit: 'abc', hasUpstream: false }, { branch: 'feat', commit: 'abc', ahead: 0, hasUpstream: true })).toBe(true);
  });
  it('ignores commits, pulls, checkouts and unchanged state', () => {
    expect(isPush({ ...head, ahead: 0 }, { ...head, commit: 'def', ahead: 1 })).toBe(false);
    expect(isPush({ ...head, ahead: 0, behind: 1 } as never, { ...head, commit: 'def', ahead: 0 })).toBe(false);
    expect(isPush({ ...head, ahead: 1 }, { ...head, branch: 'other', ahead: 0 })).toBe(false);
    expect(isPush({ ...head, ahead: 0 }, { ...head, ahead: 0 })).toBe(false);
  });
});

describe('builds', () => {
  const run = (name: string, commit: string | undefined, created: string) => ({
    metadata: { name, creationTimestamp: created },
    spec: { workflow: { parameters: { repository: { revision: { commit } } } } },
  });

  it('finds the run for a commit by its commit parameter, short or full', () => {
    const runs = [run('a', 'aaaaaaa', '2026-11-18T10:00:00Z'), run('b', 'b1b2c3d4e5f6', '2026-11-18T10:01:00Z')];
    expect(findRunForCommit(runs, { paths }, 'b1b2c3d4e5f60000', 0)?.metadata?.name).toBe('b');
    expect(findRunForCommit(runs, { paths }, 'b1b2c3d', 0)?.metadata?.name).toBe('b');
  });

  it('falls back to the first run created after the push', () => {
    const since = Date.parse('2026-11-18T10:00:30Z');
    const runs = [run('old', undefined, '2026-11-18T09:00:00Z'), run('later', undefined, '2026-11-18T10:02:00Z'), run('new', undefined, '2026-11-18T10:01:00Z')];
    expect(findRunForCommit(runs, { paths }, 'ccc', since)?.metadata?.name).toBe('new');
    expect(findRunForCommit([runs[0]], { paths }, 'ccc', since)).toBeUndefined();
  });

  it('sets the commit and branch without touching the component parameters', () => {
    const parameters = { repository: { url: 'u', revision: { branch: 'main' } }, docker: { context: '.' } };
    const out = parametersForCommit({ paths, parameters }, 'abc123', 'feat');
    expect(out).toEqual({ repository: { url: 'u', revision: { branch: 'feat', commit: 'abc123' } }, docker: { context: '.' } });
    expect(parameters.repository.revision).toEqual({ branch: 'main' });
    expect(() => parametersForCommit({ paths: { url: 'x' }, parameters }, 'abc')).toThrow(/commit/);
  });

  it('reads run phases', () => {
    expect(runOutcome('Succeeded')).toBe('succeeded');
    expect(runOutcome('Failed')).toBe('failed');
    expect(runOutcome('Error')).toBe('failed');
    expect(runOutcome('Running')).toBe('running');
    expect(runOutcome(undefined)).toBe('running');
  });
});

describe('clone', () => {
  it('names the directory like git clone', () => {
    expect(cloneDirName('https://github.com/openchoreo/sample-workloads.git')).toBe('sample-workloads');
    expect(cloneDirName('git@github.com:acme/API.git')).toBe('API');
  });
});

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { friendlyError, parsePrintEnv, remoteArgs, tunnelKey, TunnelSession } from '../devloop/tunnels';
import { mergeEnv, readLaunchSettings } from '../devloop/debugAgainstEnv';
import { occHomeOverride } from '../cli/cliPath';

const fakeOcc = path.resolve(__dirname, '../../test-fixtures/fake-occ/occ-remote.mjs');
const channel = { appendLine: () => {}, append: () => {}, show: () => {}, dispose: () => {} } as never;

describe('occ remote --print-env', () => {
  it('parses bindings, hidden values and the open marker', () => {
    const out = [
      'Resolving...',
      '',
      'Environment bindings:',
      '  export DB_HOST=127.0.0.1',
      '  export URL=http://127.0.0.1:5000/api?x=1',
      '  export PASSWORD=<hidden; pass --show-secrets to print it>',
      '',
      'Tunnels open. The session renews automatically; press Ctrl-C to disconnect.',
    ].join('\n');
    expect(parsePrintEnv(out)).toEqual({
      env: { DB_HOST: '127.0.0.1', URL: 'http://127.0.0.1:5000/api?x=1' },
      hidden: ['PASSWORD'],
      open: true,
    });
    expect(parsePrintEnv('Environment bindings:\n  export A=1\n').open).toBe(false);
  });

  it('builds the command line', () => {
    expect(
      remoteArgs({
        workloads: ['/w/api/workload.yaml', '/w/web/workload.yaml'],
        environment: 'development',
        namespace: 'acme',
        local: { web: '127.0.0.1:3000' },
        secrets: false,
        cwd: '/w',
      }),
    ).toEqual(['remote', 'api/workload.yaml', 'web/workload.yaml', '--env', 'development', '--namespace', 'acme', '--local', 'web=127.0.0.1:3000', '--print-env', '--no-secrets']);
  });

  it('keys sessions independently of workload order', () => {
    expect(tunnelKey({ workloads: ['b', 'a'], environment: 'dev' })).toBe(tunnelKey({ workloads: ['a', 'b'], environment: 'dev' }));
    expect(tunnelKey({ workloads: ['a'], environment: 'dev' })).not.toBe(tunnelKey({ workloads: ['a'], environment: 'stg' }));
  });

  it('runs occ in the background, captures the bindings and stops it', async () => {
    const session = new TunnelSession(
      { workloads: ['/w/workload.yaml'], environment: 'development', secrets: true, cwd: '/' },
      fakeOcc,
      channel,
    );
    const result = await session.ready;
    expect(result.env).toMatchObject({ DB_HOST: '127.0.0.1', DB_PORT: '54321', DB_PASSWORD: 's3cret' });
    expect(result.env.ARGS).toContain('--print-env --show-secrets');
    expect(session.running).toBe(true);
    const exited = new Promise<void>((r) => session.onDidExit(() => r()));
    session.dispose();
    await exited;
    expect(session.running).toBe(false);
  });

  it('reports a failed start', async () => {
    process.env.FAKE_OCC_FAIL = '1';
    try {
      const session = new TunnelSession({ workloads: ['/w/workload.yaml'], environment: 'dev', secrets: true, cwd: '/' }, fakeOcc, channel);
      await expect(session.ready).rejects.toThrow(/role doesn't allow/);
    } finally {
      delete process.env.FAKE_OCC_FAIL;
    }
  });

  it('explains failures the docs describe', () => {
    expect(friendlyError('Error: remote connect is not enabled')).toMatch(/remoteConnect\.enabled/);
    expect(friendlyError('dial router 127.0.0.1:30443: connection refused')).toMatch(/remoteAgentRouter/);
    expect(friendlyError('something else')).toBeUndefined();
  });
});

describe('launch settings', () => {
  it('validates the openchoreo launch attribute', () => {
    expect(readLaunchSettings({ environment: 'development', workload: 'workload.yaml' })).toEqual({
      environment: 'development',
      workload: 'workload.yaml',
      namespace: undefined,
      local: undefined,
      secrets: true,
    });
    expect(readLaunchSettings({ workload: 'w.yaml' })).toMatch(/environment/);
    expect(readLaunchSettings({ environment: 'd', workload: [] })).toMatch(/workload/);
    expect(readLaunchSettings({ environment: 'd', workload: 'w', local: { web: 3000 } })).toMatch(/local/);
    expect(readLaunchSettings('dev')).toMatch(/object/);
  });

  it('lets tunnel bindings override the configuration env', () => {
    expect(mergeEnv({ DB_HOST: 'localhost', LOG: 'debug' }, { DB_HOST: '127.0.0.1' })).toEqual({ DB_HOST: '127.0.0.1', LOG: 'debug' });
    expect(mergeEnv(undefined, { A: '1' })).toEqual({ A: '1' });
  });
});

describe('occ config home', () => {
  it('points occ at the home of a custom .openchoreo/config', () => {
    expect(occHomeOverride('/tmp/demo/.openchoreo/config')).toMatchObject({ HOME: '/tmp/demo' });
    expect(occHomeOverride('')).toEqual({});
    expect(occHomeOverride('/etc/occ.yaml')).toEqual({});
  });
});

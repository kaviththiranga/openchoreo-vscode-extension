// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { spawn } from 'child_process';
import { once } from 'events';
import { terminateServerProcess } from '../services/occLanguageServer';

describe('language-server process cleanup', () => {
  it('waits for an actual child to exit and tolerates repeated cleanup', async () => {
    const child = spawn(process.execPath, ['-e', "console.log('ready'); setInterval(() => {}, 1000)"], { stdio: 'pipe' });
    try {
      await once(child.stdout!, 'data');
      await terminateServerProcess(child);
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      await terminateServerProcess(child);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  });
  it.skipIf(process.platform === 'win32')('force-stops a child ignoring graceful termination', async () => {
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"], { stdio: 'pipe' });
    try {
      await once(child.stdout!, 'data');
      await terminateServerProcess(child);
      expect(child.signalCode).toBe('SIGKILL');
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  });
});

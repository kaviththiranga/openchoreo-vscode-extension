// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginRunner } from '../auth/loginRunner';
import { OccLanguageServer } from '../services/occLanguageServer';

vi.mock('child_process', () => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock('../cli/cliPath', () => ({ occEnv: () => ({}) }));

function fixture() {
  vi.spyOn(vscode.window, 'createOutputChannel').mockReturnValue({
    clear: vi.fn(), show: vi.fn(), append: vi.fn(), appendLine: vi.fn(), dispose: vi.fn(),
  } as unknown as ReturnType<typeof vscode.window.createOutputChannel>);
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  return { child, runner: new LoginRunner(() => '/custom/occ') };
}

describe('successful login recovery', () => {
  afterEach(() => vi.restoreAllMocks());

  it('restarts a stopped language server after login and session reload', async () => {
    const { child, runner } = fixture();
    const createClient = vi.fn(() => {
      let running = false;
      return {
        start: async () => { running = true; },
        stop: async () => { running = false; },
        dispose: async () => {}, isRunning: () => running,
        sendNotification: async () => {},
      };
    });
    const server = new OccLanguageServer({
      resolveBinary: () => '/custom/occ', checkBinary: async () => {},
      createClient, refresh: async () => {}, report: vi.fn(),
    });
    await server.start();
    await server.stop();
    const order: string[] = [];
    runner.onStateChange(() => { if (!runner.isRunning()) order.push('reload'); });
    let recovery: Promise<void> | undefined;
    runner.onDidLogin(() => { order.push('restart'); recovery = server.restart(); });
    runner.start();
    child.emit('exit', 0, null);
    await recovery;
    expect(order).toEqual(['reload', 'restart']);
    expect(server.isRunning()).toBe(true);
    expect(createClient).toHaveBeenCalledTimes(2);
    await server.dispose();
    runner.dispose();
  });

  it.each([[1, null], [null, 'SIGTERM'], [null, 'SIGKILL']])(
    'does not signal success for exit %s / %s', (code, signal) => {
      const { child, runner } = fixture();
      const success = vi.fn();
      runner.onDidLogin(success);
      runner.start();
      child.emit('exit', code, signal);
      expect(success).not.toHaveBeenCalled();
      runner.dispose();
    },
  );

  it('does not signal success when the login process cannot start', () => {
    const { child, runner } = fixture();
    const success = vi.fn();
    runner.onDidLogin(success);
    runner.start();
    child.emit('error', new Error('Cannot spawn occ'));
    expect(success).not.toHaveBeenCalled();
    runner.dispose();
  });

  it('starts one login process and signals success once for concurrent login attempts', () => {
    const { child, runner } = fixture();
    const success = vi.fn();
    const calls = vi.mocked(spawn).mock.calls.length;
    runner.onDidLogin(success);
    runner.start();
    runner.start();
    child.emit('exit', 0, null);
    expect(vi.mocked(spawn).mock.calls.length - calls).toBe(1);
    expect(success).toHaveBeenCalledTimes(1);
    runner.dispose();
  });
});

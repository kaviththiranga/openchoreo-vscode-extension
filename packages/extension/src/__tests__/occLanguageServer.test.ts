// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import { execFile } from 'child_process';
import { checkOccLsp, OccLanguageServer, type ManagedLanguageClient } from '../services/occLanguageServer';
vi.mock('child_process', () => ({ execFile: vi.fn() }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
function fixture() {
  const clients: ManagedLanguageClient[] = [];
  const guards: Array<() => boolean> = [];
  const refresh = vi.fn(async (_client: ManagedLanguageClient, current: () => boolean) => { guards.push(current); });
  const report = vi.fn();
  const checkBinary = vi.fn(async (_binary: string) => {});
  let closed = () => {};
  const createClient = vi.fn((_binary: string, onClosed: () => void) => {
    let running = false;
    closed = onClosed;
    const client = {
      start: vi.fn(async () => { running = true; }),
      stop: vi.fn(async () => { running = false; }),
      dispose: vi.fn(async () => {}),
      isRunning: () => running,
      sendNotification: vi.fn(async (_method: string, _params: unknown) => {}),
    };
    clients.push(client);
    return client;
  });
  const manager = new OccLanguageServer({ resolveBinary: () => '/custom path/occ', checkBinary, createClient, refresh, report });
  return { manager, clients, guards, refresh, report, checkBinary, createClient, close: () => closed() };
}
describe('CLI compatibility', () => {
  it('probes an absolute path directly with bounded execution', async () => {
    vi.mocked(execFile).mockImplementation(((...args: any[]) => {
      args[3](null, 'Usage: occ lsp [flags]\n --stdio', '');
    }) as any);
    await checkOccLsp('/custom path/occ');
    expect(execFile).toHaveBeenLastCalledWith('/custom path/occ', ['lsp', '--help'], expect.objectContaining({ timeout: 5000, maxBuffer: 65536 }), expect.any(Function));
  });
  it.each([
    [{ code: 'ENOENT' }, '', 'CLI not found'],
    [{ code: 'EACCES' }, '', 'Permission denied'],
    [{ killed: true }, '', 'timed out'],
    [null, 'Usage: occ', 'does not support'],
  ])('rejects unavailable or incompatible executables', async (error, stdout, message) => {
    vi.mocked(execFile).mockImplementation(((...args: any[]) => { args[3](error, stdout, 'sensitive stderr'); }) as any);
    await expect(checkOccLsp('occ')).rejects.toThrow(message);
  });
});
describe('language-server lifecycle', () => {
  it('only accepts CEL completion replies from the current running client', async () => {
    const f = fixture(), position = {line: 1, character: 12};
    expect(await f.manager.hasCELCompletions('file:///type.yaml', position)).toBe(false);
    await f.manager.start();
    f.clients[0].hasCELCompletions = vi.fn(async () => true);
    expect(await f.manager.hasCELCompletions('file:///type.yaml', position)).toBe(true);
    const pending = deferred();
    f.clients[0].hasCELCompletions = async () => { await pending.promise; return true; };
    const reply = f.manager.hasCELCompletions('file:///type.yaml', position);
    await f.manager.restart();
    pending.resolve();
    expect(await reply).toBe(false);
    await f.manager.dispose();
    expect(await f.manager.hasCELCompletions('file:///type.yaml', position)).toBe(false);
  });
  it('coalesces activation and clears feeds after initialization', async () => {
    const f = fixture(), ready = deferred();
    f.checkBinary.mockImplementation(() => ready.promise);
    expect(f.manager.isRunning()).toBe(false);
    const first = f.manager.start(), second = f.manager.start();
    await Promise.resolve();
    expect(f.refresh).not.toHaveBeenCalled();
    ready.resolve();
    await Promise.all([first, second]);
    expect(f.manager.isRunning()).toBe(true);
    expect(f.createClient).toHaveBeenCalledTimes(1);
    expect(f.createClient.mock.calls[0][0]).toBe('/custom path/occ');
    expect(f.clients[0].sendNotification).toHaveBeenNthCalledWith(1, 'openchoreo/updateResources', {});
    expect(f.clients[0].sendNotification).toHaveBeenNthCalledWith(2, 'openchoreo/updateResourceSchemas', {});
    expect(f.refresh).toHaveBeenCalledTimes(1);
    await f.manager.dispose();
  });
  it('stops and disposes the old client and revalidates on restart', async () => {
    const f = fixture();
    await f.manager.start();
    await f.manager.restart();
    expect(f.clients[0].stop).toHaveBeenCalledTimes(1);
    expect(f.clients[0].dispose).toHaveBeenCalledTimes(1);
    expect(f.checkBinary).toHaveBeenCalledTimes(2);
    expect(f.refresh).toHaveBeenCalledTimes(2);
    await f.manager.dispose();
    expect(f.clients[1].stop).toHaveBeenCalledTimes(1);
  });
  it('provides manual recovery without automatic retries or sensitive error text', async () => {
    const f = fixture();
    f.checkBinary.mockRejectedValueOnce(new Error('Authentication required: secret-token'));
    await f.manager.start();
    expect(f.report.mock.calls[0][0]).toContain('occ login');
    expect(f.report.mock.calls[0][0]).not.toContain('secret-token');
    await f.manager.start();
    expect(f.checkBinary).toHaveBeenCalledTimes(1);
    await f.manager.restart();
    expect(f.clients).toHaveLength(1);
    f.close();
    expect(f.createClient).toHaveBeenCalledTimes(1);
    await f.manager.dispose();
  });
  it('invalidates old feeds after context change, logout, restart and disposal', async () => {
    const f = fixture();
    await f.manager.start();
    expect(f.guards[0]()).toBe(true);
    await f.manager.refresh();
    expect(f.guards[0]()).toBe(false);
    expect(f.guards[1]()).toBe(true);
    await f.manager.stop();
    expect(f.guards[1]()).toBe(false);
    await f.manager.restart();
    expect(f.guards[2]()).toBe(true);
    await f.manager.dispose();
    expect(f.guards[2]()).toBe(false);
    await f.manager.restart();
    expect(f.clients).toHaveLength(2);
  });
  it.each(['stop', 'dispose'] as const)('cancels startup on %s during compatibility check', async action => {
    const f = fixture(), ready = deferred();
    f.checkBinary.mockImplementation(() => ready.promise);
    const start = f.manager.start();
    await Promise.resolve();
    await Promise.resolve();
    const end = f.manager[action]();
    ready.resolve();
    await Promise.all([start, end]);
    expect(f.createClient).not.toHaveBeenCalled();
  });
  it('does not block logout on slow cluster API requests', async () => {
    const f = fixture(), api = deferred();
    let current: (() => boolean) | undefined;
    f.refresh.mockImplementation(async (_client, guard) => { current = guard; await api.promise; });
    await f.manager.start();
    await Promise.resolve();
    await f.manager.stop();
    expect(f.clients[0].stop).toHaveBeenCalledTimes(1);
    expect(current?.()).toBe(false);
    api.resolve();
    await f.manager.dispose();
  });
  it('cleans up initialization failures and permits explicit recovery', async () => {
    const f = fixture();
    const normal = f.createClient.getMockImplementation()!;
    f.createClient.mockImplementationOnce((binary, closed) => {
      const client = normal(binary, closed);
      client.start.mockRejectedValueOnce(new Error('Initialization failed'));
      return client;
    });
    await f.manager.start();
    expect(f.clients[0].stop).toHaveBeenCalledTimes(1);
    expect(f.clients[0].dispose).toHaveBeenCalledTimes(1);
    await f.manager.restart();
    expect(f.clients).toHaveLength(2);
    await f.manager.dispose();
  });
});

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { SidebarViewProvider } from '../webview/sidebarViewProvider';
import type { ExtToWebviewMessage, WebviewToExtMessage } from '../webview/protocol';

function fixture() {
  const explorer = () => {
    const changed = new vscode.EventEmitter<void>();
    return { onDidChangeTreeData: changed.event, refresh: vi.fn(() => changed.fire()), getChildren: vi.fn(async () => []) };
  };
  const [projects, infrastructure, cluster] = [explorer(), explorer(), explorer()];
  const session = new vscode.EventEmitter<void>();
  const auth = { onDidChangeSession: session.event, getContextInfo: () => undefined, getSession: () => undefined, getUserIdentity: () => undefined };
  const loginRunner = { onStateChange: new vscode.EventEmitter<void>().event, isRunning: () => false, consumeLastError: () => undefined };
  const cli = { get: async () => ({ installed: true }) };
  const provider = new SidebarViewProvider(
    {} as vscode.Uri, auth as never, projects as never, infrastructure as never, cluster as never, cli as never, loginRunner as never,
  );
  const posted: ExtToWebviewMessage[] = [];
  (provider as unknown as { postMessage: (m: ExtToWebviewMessage) => void }).postMessage = (m) => posted.push(m);
  const receive = (msg: WebviewToExtMessage) => (provider as unknown as { handleMessage: (m: WebviewToExtMessage) => Promise<void> }).handleMessage(msg);
  return { provider, projects, infrastructure, cluster, posted, receive };
}

describe('sidebar refresh', () => {
  afterEach(() => vi.useRealTimers());

  it('reloads the section of an explorer that refreshed, e.g. from Refresh Resources or auto-refresh', () => {
    vi.useFakeTimers();
    const f = fixture();
    f.projects.refresh();
    f.projects.refresh();
    vi.advanceTimersByTime(60);
    expect(f.posted).toEqual([{ type: 'refreshSection', section: 'projects' }]);
  });

  it('coalesces refreshes of every explorer into one full refresh', () => {
    vi.useFakeTimers();
    const f = fixture();
    f.projects.refresh();
    f.infrastructure.refresh();
    f.cluster.refresh();
    f.provider.refreshAll();
    vi.advanceTimersByTime(60);
    expect(f.posted).toEqual([{ type: 'refreshAll' }]);
  });

  it("answers the section's refresh button through the explorer", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.receive({ type: 'refresh', section: 'cluster' });
    vi.advanceTimersByTime(60);
    expect(f.cluster.refresh).toHaveBeenCalledOnce();
    expect(f.posted).toEqual([{ type: 'refreshSection', section: 'cluster' }]);
  });
});

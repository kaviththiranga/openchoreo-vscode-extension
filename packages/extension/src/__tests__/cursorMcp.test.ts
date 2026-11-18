// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'vscode';
import { registerWithCursor, type CursorMcpApi } from '../mcp/cursorMcp';
import type { McpServerSpec } from '../mcp/mcpServers';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('registerWithCursor', () => {
  it('re-registers servers when the session changes and cleans up on dispose', async () => {
    const calls: string[] = [];
    const api: CursorMcpApi = {
      registerServer: (c) => calls.push(`+${c.name} ${c.server.headers?.Authorization ?? 'no-auth'}`),
      unregisterServer: (name) => calls.push(`-${name}`),
    };
    let token = 'a';
    const specs = async (): Promise<McpServerSpec[]> => [
      { label: 'openchoreo-cp', url: 'http://cp/mcp', headers: { Authorization: `Bearer ${token}` } },
    ];
    const changed = new EventEmitter<void>();
    const registration = registerWithCursor(api, specs, changed.event);
    await flush();
    token = 'b';
    changed.fire();
    await flush();
    registration.dispose();
    expect(calls).toEqual(['+openchoreo-cp Bearer a', '-openchoreo-cp', '+openchoreo-cp Bearer b', '-openchoreo-cp']);
  });
});

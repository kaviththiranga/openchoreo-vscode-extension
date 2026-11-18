// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { log } from '../logging/logger';
import type { McpServerSpec } from './mcpServers';

/** Cursor's extension MCP API (vscode.cursor.mcp), absent in VS Code. */
export interface CursorMcpApi {
  registerServer(config: { name: string; server: { url: string; headers?: Record<string, string> } }): void;
  unregisterServer(name: string): void;
}

export function cursorMcpApi(): CursorMcpApi | undefined {
  const api = (vscode as unknown as { cursor?: { mcp?: Partial<CursorMcpApi> } }).cursor?.mcp;
  return api?.registerServer && api.unregisterServer ? (api as CursorMcpApi) : undefined;
}

/**
 * Keeps Cursor's MCP servers in step with the OpenChoreo session: Cursor has
 * no provider callback, so servers are re-registered whenever the list or the
 * token changes. Cursor has been reported to drop `headers` on remote
 * servers; until it sends them, authenticated clusters reject the calls.
 */
export function registerWithCursor(
  api: CursorMcpApi,
  computeSpecs: () => Promise<McpServerSpec[]>,
  onDidChange: vscode.Event<void>,
): vscode.Disposable {
  let registered: string[] = [];
  let pending = Promise.resolve();

  const sync = () => {
    pending = pending.then(async () => {
      try {
        const specs = await computeSpecs();
        for (const name of registered) api.unregisterServer(name);
        for (const spec of specs) {
          api.registerServer({
            name: spec.label,
            server: { url: spec.url, ...(Object.keys(spec.headers).length ? { headers: spec.headers } : {}) },
          });
        }
        registered = specs.map((s) => s.label);
      } catch (err) {
        log.error('MCP: registering servers with Cursor failed', err);
      }
    });
  };

  sync();
  const subscription = onDidChange(sync);
  return {
    dispose: () => {
      subscription.dispose();
      for (const name of registered) api.unregisterServer(name);
    },
  };
}

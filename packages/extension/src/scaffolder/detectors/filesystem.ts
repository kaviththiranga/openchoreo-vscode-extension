// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';

/**
 * Abstract filesystem the detectors operate on.
 *
 * Keeping this an interface (and the detectors free of `vscode` imports)
 * means detection can be reused in environments without a VS Code API —
 * unit tests with a memory FS, or an MCP tool with a Node fs adapter.
 */
export interface DetectorFs {
  /** Check if a file exists at a path relative to the workspace root. */
  exists(relativePath: string): Promise<boolean>;
  /** Read a file as UTF-8 text. Returns undefined if the file doesn't exist. */
  readText(relativePath: string): Promise<string | undefined>;
  /** List entries in a directory relative to the workspace root. Returns [] if missing. */
  list(relativePath: string): Promise<string[]>;
}

/** DetectorFs implementation backed by vscode.workspace.fs — works for remote/web workspaces. */
export function createVscodeFs(root: vscode.Uri): DetectorFs {
  const resolve = (rel: string) => vscode.Uri.joinPath(root, rel);
  return {
    async exists(rel) {
      try {
        await vscode.workspace.fs.stat(resolve(rel));
        return true;
      } catch {
        return false;
      }
    },
    async readText(rel) {
      try {
        const bytes = await vscode.workspace.fs.readFile(resolve(rel));
        return new TextDecoder('utf-8').decode(bytes);
      } catch {
        return undefined;
      }
    },
    async list(rel) {
      try {
        const entries = await vscode.workspace.fs.readDirectory(resolve(rel));
        return entries.map(([name]) => name);
      } catch {
        return [];
      }
    },
  };
}

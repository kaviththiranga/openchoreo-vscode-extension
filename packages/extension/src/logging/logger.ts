// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

/** Initialize the output channel. Call once during extension activation. */
export function initLogger(): void {
  outputChannel = vscode.window.createOutputChannel('OpenChoreo');
}

function timestamp(): string {
  return new Date().toISOString();
}

export const log = {
  info(msg: string): void {
    outputChannel?.appendLine(`[${timestamp()}] INFO  ${msg}`);
  },
  error(msg: string, err?: unknown): void {
    const errMsg = err instanceof Error ? `: ${err.message}` : err ? `: ${String(err)}` : '';
    outputChannel?.appendLine(`[${timestamp()}] ERROR ${msg}${errMsg}`);
  },
  debug(msg: string): void {
    outputChannel?.appendLine(`[${timestamp()}] DEBUG ${msg}`);
  },
};

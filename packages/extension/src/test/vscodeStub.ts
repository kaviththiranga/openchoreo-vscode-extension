// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Minimal stand-in for the `vscode` module so unit tests can import
 * extension modules outside the extension host. Extend as tests need more.
 */
export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];
  readonly event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => (this.listeners = this.listeners.filter((l) => l !== listener)) };
  };
  fire(e: T): void {
    for (const l of this.listeners) l(e);
  }
  dispose(): void {
    this.listeners = [];
  }
}

export const window = {
  createOutputChannel: () => ({ appendLine: () => {}, show: () => {}, dispose: () => {} }),
};

export const workspace = {
  getConfiguration: () => ({ get: () => undefined }),
};

export const Uri = {
  parse: (value: string) => ({ toString: () => value }),
};

export const commands = { registerCommand: () => ({ dispose: () => {} }) };

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

class TestUri {
  constructor(readonly scheme: string, readonly authority: string, readonly path: string, readonly query = '') {}
  toString(): string {
    return `${this.scheme}:${this.authority ? '//'+this.authority : ''}${this.path}${this.query ? '?'+this.query : ''}`;
  }
  get fsPath(): string { return this.path; }
}
export const Uri = {
  parse: (value: string) => { const u=new URL(value); return new TestUri(u.protocol.slice(0,-1),u.host,decodeURIComponent(u.pathname),u.search.slice(1)); },
  from: (value: {scheme: string; authority?: string; path: string; query?: string}) => new TestUri(value.scheme,value.authority??'',value.path,value.query),
  file: (fsPath: string) => ({ fsPath, path: fsPath, scheme: 'file', toString: () => `file://${fsPath}` }),
};
export class FileSystemError extends Error {
  static Unavailable(message: string): FileSystemError { return new FileSystemError(message); }
  static FileNotFound(message: unknown): FileSystemError { return new FileSystemError(String(message)); }
}
export const FileType = {File: 1};
export const FilePermission = {Readonly: 1};


export const commands = { registerCommand: () => ({ dispose: () => {} }) };

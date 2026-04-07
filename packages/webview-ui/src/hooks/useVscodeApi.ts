// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { WebviewToExtMessage } from '../types/protocol';

interface VsCodeApi {
  postMessage(msg: WebviewToExtMessage): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

// acquireVsCodeApi() can only be called once per webview lifecycle
export const vscode: VsCodeApi = (window as any).acquireVsCodeApi();

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Mirrors the extension's webview protocol types.
 * Kept in sync manually — serialized over postMessage as plain JSON.
 */

import type { ResourceNodeData } from './nodes';

export type TreeSection = 'projects' | 'infrastructure' | 'cluster';

export interface AuthState {
  connected: boolean;
  namespace?: string;
  contextName?: string;
}

// Webview → Extension
export type WebviewToExtMessage =
  | { type: 'ready' }
  | { type: 'requestRoots'; section: TreeSection }
  | { type: 'requestChildren'; section: TreeSection; nodeId: string; lazyChildrenKey: string }
  | { type: 'nodeClicked'; section: TreeSection; node: ResourceNodeData }
  | { type: 'executeCommand'; command: string; args?: unknown[] }
  | { type: 'refresh'; section?: TreeSection }
  | { type: 'selectNamespace' };

// Extension → Webview
export type ExtToWebviewMessage =
  | { type: 'setAuthState'; state: AuthState }
  | { type: 'setIconsBaseUri'; uri: string; fontUri: string }
  | { type: 'setRoots'; section: TreeSection; nodes: ResourceNodeData[] }
  | { type: 'setChildren'; section: TreeSection; nodeId: string; nodes: ResourceNodeData[] }
  | { type: 'refreshAll' }
  | { type: 'refreshSection'; section: TreeSection };

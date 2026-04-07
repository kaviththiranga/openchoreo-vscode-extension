// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Message protocol between the sidebar webview and the extension host.
 *
 * Webview → Extension: WebviewToExtMessage
 * Extension → Webview: ExtToWebviewMessage
 */

import type { ResourceNodeData } from '../treeView/types';

// ── Sections ──────────────────────────────────────────────────────────

export type TreeSection = 'projects' | 'infrastructure' | 'cluster';

// ── Auth state ────────────────────────────────────────────────────────

export interface AuthState {
  connected: boolean;
  namespace?: string;
  contextName?: string;
}

// ── Webview → Extension ──────────────────────────────────────────────

export type WebviewToExtMessage =
  | { type: 'ready' }
  | { type: 'requestRoots'; section: TreeSection }
  | { type: 'requestChildren'; section: TreeSection; nodeId: string; lazyChildrenKey: string }
  | { type: 'nodeClicked'; section: TreeSection; node: ResourceNodeData }
  | { type: 'executeCommand'; command: string; args?: unknown[] }
  | { type: 'refresh'; section?: TreeSection }
  | { type: 'selectNamespace' };

// ── Extension → Webview ──────────────────────────────────────────────

export type ExtToWebviewMessage =
  | { type: 'setAuthState'; state: AuthState }
  | { type: 'setRoots'; section: TreeSection; nodes: ResourceNodeData[] }
  | { type: 'setChildren'; section: TreeSection; nodeId: string; nodes: ResourceNodeData[] }
  | { type: 'refreshAll' }
  | { type: 'refreshSection'; section: TreeSection };

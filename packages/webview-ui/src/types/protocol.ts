// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Mirrors the extension's webview protocol types.
 * Kept in sync manually — serialized over postMessage as plain JSON.
 */

import type { ResourceNodeData } from './nodes';

export type TreeSection = 'projects' | 'infrastructure' | 'cluster';

/**
 * Connection status drives the sidebar's "not connected" onboarding view.
 * - connected:    occ session is valid, show the tree view
 * - no-cli:       occ CLI binary not found on $PATH
 * - no-session:   occ installed but no valid session in ~/.openchoreo/config
 * - logging-in:   an `occ login` child process is currently running
 * - login-failed: the last login attempt exited with a non-zero status
 */
export type ConnectionStatus =
  | 'connected'
  | 'no-cli'
  | 'no-session'
  | 'logging-in'
  | 'login-failed';

export interface AuthState {
  connected: boolean;
  status: ConnectionStatus;
  namespace?: string;
  contextName?: string;
  /** Populated when status !== 'no-cli'. Shown as a footnote in no-session view. */
  cliVersion?: string;
  /** Full `occ version` output — shown as a tooltip on the cliVersion footnote. */
  cliVersionDetails?: string;
  /** Populated when status === 'login-failed'. Last lines of stderr from `occ login`. */
  loginError?: string;
}

// Webview → Extension
export type WebviewToExtMessage =
  | { type: 'ready' }
  | { type: 'requestRoots'; section: TreeSection }
  | { type: 'requestChildren'; section: TreeSection; nodeId: string; lazyChildrenKey: string }
  | { type: 'nodeClicked'; section: TreeSection; node: ResourceNodeData }
  | { type: 'executeCommand'; command: string; args?: unknown[] }
  | { type: 'refresh'; section?: TreeSection }
  | { type: 'selectNamespace' }
  | { type: 'startLogin' }
  | { type: 'cancelLogin' }
  | { type: 'recheckCli' }
  | { type: 'openExternal'; url: string };

// Extension → Webview
export type ExtToWebviewMessage =
  | { type: 'setAuthState'; state: AuthState }
  | { type: 'setIconsBaseUri'; uri: string; fontUri: string }
  | { type: 'setRoots'; section: TreeSection; nodes: ResourceNodeData[] }
  | { type: 'setChildren'; section: TreeSection; nodeId: string; nodes: ResourceNodeData[] }
  | { type: 'refreshAll' }
  | { type: 'refreshSection'; section: TreeSection };

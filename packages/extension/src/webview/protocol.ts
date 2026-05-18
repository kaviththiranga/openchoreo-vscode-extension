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

/**
 * Connection status drives the sidebar's "not connected" onboarding view.
 * Kept in sync with packages/webview-ui/src/types/protocol.ts.
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
  /** Human-readable display name from the JWT access token, if available. */
  userDisplayName?: string;
  cliVersion?: string;
  /** Full `occ version` output — shown as a tooltip on the cliVersion footnote. */
  cliVersionDetails?: string;
  loginError?: string;
  /**
   * True when the control plane reports `openchoreo_security_enabled: false`.
   * The sidebar uses this to show an "auth disabled" badge and hide the user
   * chip (there's no JWT identity when auth is disabled).
   */
  securityDisabled?: boolean;
}

// ── Webview → Extension ──────────────────────────────────────────────

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
  | { type: 'downloadCli' }
  | { type: 'openExternal'; url: string };

// ── Extension → Webview ──────────────────────────────────────────────

export type ExtToWebviewMessage =
  | { type: 'setAuthState'; state: AuthState }
  | { type: 'setIconsBaseUri'; uri: string; fontUri: string }
  | { type: 'setRoots'; section: TreeSection; nodes: ResourceNodeData[] }
  | { type: 'setChildren'; section: TreeSection; nodeId: string; nodes: ResourceNodeData[] }
  | { type: 'refreshAll' }
  | { type: 'refreshSection'; section: TreeSection };

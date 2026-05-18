// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { getFontChar } from './icons';

interface NamespaceHeaderProps {
  namespace?: string;
  contextName?: string;
  userDisplayName?: string;
  /** True when the cluster has authentication disabled. */
  securityDisabled?: boolean;
  onSelectNamespace: () => void;
  onSwitchContext: () => void;
  onLogout: () => void;
}

export function NamespaceHeader({
  namespace,
  contextName,
  userDisplayName,
  securityDisabled,
  onSelectNamespace,
  onSwitchContext,
  onLogout,
}: NamespaceHeaderProps) {
  const ocChar = getFontChar('logo');
  const nsChar = getFontChar('apartment');

  // When auth is disabled, occ logout still works (it clears the local
  // context entry) but the wording "logout" implies an authenticated
  // session is being terminated — soften it.
  const logoutTitle = securityDisabled
    ? 'Disconnect from OpenChoreo context (clears the local context entry)'
    : 'Logout from OpenChoreo (also logs out the occ CLI)';

  const authDisabledTitle =
    'This OpenChoreo cluster has authentication disabled. The extension is connected without credentials.';

  // With auth disabled, there is no JWT identity, so the user chip is
  // suppressed entirely — the auth-disabled badge takes its place
  // on the chips row.
  const showUserChip = !!userDisplayName && !securityDisabled;

  return (
    <div class="context-header-wrapper">
      {showUserChip ? (
        <div class="user-chip-row">
          <div class="user-chip" title={userDisplayName}>
            <i class="codicon codicon-account chip-leading-icon" />
            <span class="chip-text">{userDisplayName}</span>
            <button
              class="chip-action"
              title={logoutTitle}
              aria-label={logoutTitle}
              onClick={onLogout}
            >
              <i class="codicon codicon-log-out" />
            </button>
          </div>
        </div>
      ) : null}
      <div class="context-header">
        <button class="context-chip" title="Switch Context" onClick={onSwitchContext}>
          {ocChar
            ? <span class="chip-font-icon">{ocChar}</span>
            : <span class="chip-label">ctx:</span>
          }
          <span class="chip-text">{contextName || 'None'}</span>
          <i class="codicon codicon-chevron-down chip-arrow" />
        </button>
        <span class="context-separator">/</span>
        <button class="context-chip" title="Select Namespace" onClick={onSelectNamespace}>
          {nsChar
            ? <span class="chip-font-icon">{nsChar}</span>
            : <span class="chip-label">ns:</span>
          }
          <span class="chip-text">{namespace || 'None'}</span>
          <i class="codicon codicon-chevron-down chip-arrow" />
        </button>
        {securityDisabled && (
          <span
            class="auth-disabled-badge"
            title={authDisabledTitle}
            aria-label={authDisabledTitle}
          >
            <i class="codicon codicon-unlock" />
            <span class="auth-disabled-label">auth off</span>
          </span>
        )}
        {!showUserChip && (
          <button
            class="header-icon-button"
            title={logoutTitle}
            aria-label={logoutTitle}
            onClick={onLogout}
          >
            <i class="codicon codicon-log-out" />
          </button>
        )}
      </div>
    </div>
  );
}

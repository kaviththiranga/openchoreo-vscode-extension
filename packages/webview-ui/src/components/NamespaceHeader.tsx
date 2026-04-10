// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { getFontChar } from './icons';

interface NamespaceHeaderProps {
  namespace?: string;
  contextName?: string;
  userDisplayName?: string;
  onSelectNamespace: () => void;
  onSwitchContext: () => void;
  onLogout: () => void;
}

export function NamespaceHeader({
  namespace,
  contextName,
  userDisplayName,
  onSelectNamespace,
  onSwitchContext,
  onLogout,
}: NamespaceHeaderProps) {
  const ocChar = getFontChar('logo');
  const nsChar = getFontChar('apartment');

  const logoutTitle = 'Logout from OpenChoreo (also logs out the occ CLI)';

  return (
    <div class="context-header-wrapper">
      {userDisplayName && (
        <div class="user-row">
          <i class="codicon codicon-account" />
          <span class="user-name" title={userDisplayName}>{userDisplayName}</span>
          <button
            class="header-icon-button"
            title={logoutTitle}
            aria-label={logoutTitle}
            onClick={onLogout}
          >
            <i class="codicon codicon-sign-out" />
          </button>
        </div>
      )}
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
        {!userDisplayName && (
          <button
            class="header-icon-button"
            title={logoutTitle}
            aria-label={logoutTitle}
            onClick={onLogout}
          >
            <i class="codicon codicon-sign-out" />
          </button>
        )}
      </div>
    </div>
  );
}

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { getFontChar } from './icons';

interface NamespaceHeaderProps {
  namespace?: string;
  contextName?: string;
  onSelectNamespace: () => void;
  onSwitchContext: () => void;
}

export function NamespaceHeader({ namespace, contextName, onSelectNamespace, onSwitchContext }: NamespaceHeaderProps) {
  const ocChar = getFontChar('logo');
  const nsChar = getFontChar('apartment');

  return (
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
    </div>
  );
}

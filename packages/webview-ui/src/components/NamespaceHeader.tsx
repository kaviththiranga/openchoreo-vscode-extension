// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

interface NamespaceHeaderProps {
  namespace?: string;
  contextName?: string;
  onSelectNamespace: () => void;
  onSwitchContext: () => void;
}

export function NamespaceHeader({ namespace, contextName, onSelectNamespace, onSwitchContext }: NamespaceHeaderProps) {
  return (
    <div class="context-header">
      <button class="context-chip" title="Switch Context" onClick={onSwitchContext}>
        <span class="chip-label">ctx:</span>
        <span class="chip-text">{contextName || 'None'}</span>
        <i class="codicon codicon-chevron-down chip-arrow" />
      </button>
      <span class="context-separator">/</span>
      <button class="context-chip" title="Select Namespace" onClick={onSelectNamespace}>
        <span class="chip-label">ns:</span>
        <span class="chip-text">{namespace || 'None'}</span>
        <i class="codicon codicon-chevron-down chip-arrow" />
      </button>
    </div>
  );
}

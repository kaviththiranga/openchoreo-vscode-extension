// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

interface NamespaceHeaderProps {
  namespace?: string;
  contextName?: string;
  onSelectNamespace: () => void;
}

export function NamespaceHeader({ namespace, contextName, onSelectNamespace }: NamespaceHeaderProps) {
  return (
    <div class="namespace-header">
      <div class="namespace-info">
        <i class="codicon codicon-symbol-namespace" />
        <span class="namespace-name">{namespace || 'No namespace'}</span>
        {contextName && <span class="context-name">{contextName}</span>}
      </div>
      <button
        class="icon-button"
        title="Switch Namespace"
        onClick={onSelectNamespace}
      >
        <i class="codicon codicon-arrow-swap" />
      </button>
    </div>
  );
}

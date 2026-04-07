// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect } from 'preact/hooks';
import type { ResourceNodeData } from '../types/nodes';
import type { TreeSection as Section } from '../types/protocol';
import { TreeNode } from './TreeNode';
import { vscode } from '../hooks/useVscodeApi';

interface TreeSectionProps {
  title: string;
  section: Section;
  roots: ResourceNodeData[];
  childrenMap: Record<string, ResourceNodeData[]>;
  onRequestChildren: (section: Section, nodeId: string, lazyChildrenKey: string) => void;
  onNodeClick: (section: Section, node: ResourceNodeData) => void;
  onRefresh: (section: Section) => void;
  defaultExpanded?: boolean;
}

export function TreeSection({
  title,
  section,
  roots,
  childrenMap,
  onRequestChildren,
  onNodeClick,
  onRefresh,
  defaultExpanded = false,
}: TreeSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Request roots when section is first expanded
  useEffect(() => {
    if (expanded && roots.length === 0) {
      vscode.postMessage({ type: 'requestRoots', section });
    }
  }, [expanded, roots.length, section]);

  return (
    <div class="tree-section">
      <div class="section-header" onClick={() => setExpanded(!expanded)}>
        <i class={`codicon codicon-chevron-${expanded ? 'down' : 'right'} section-chevron`} />
        <span class="section-title">{title}</span>
        <div class="section-actions">
          <button
            class="icon-button"
            title={`Refresh ${title}`}
            onClick={(e) => { e.stopPropagation(); onRefresh(section); }}
          >
            <i class="codicon codicon-refresh" />
          </button>
        </div>
      </div>

      {expanded && (
        <div class="section-body" role="tree">
          {roots.length === 0 ? (
            <div class="tree-row loading-row" style={{ paddingLeft: '28px' }}>
              <i class="codicon codicon-loading spin" />
              <span class="tree-label loading-text">Loading...</span>
            </div>
          ) : (
            roots.map(node => (
              <TreeNode
                key={`${node.type}:${node.label}`}
                node={node}
                section={section}
                depth={0}
                childrenMap={childrenMap}
                onRequestChildren={onRequestChildren}
                onNodeClick={onNodeClick}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

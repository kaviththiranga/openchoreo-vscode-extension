// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { useEffect } from 'preact/hooks';
import type { ResourceNodeData } from '../types/nodes';
import type { TreeSection as Section } from '../types/protocol';
import { TreeNode } from './TreeNode';
import { vscode } from '../hooks/useVscodeApi';

interface TreeSectionProps {
  title: string;
  section: Section;
  roots: ResourceNodeData[];
  childrenMap: Record<string, ResourceNodeData[]>;
  expandedNodes: Set<string>;
  expanded: boolean;
  createCommand?: string;
  onToggleSection: (section: string) => void;
  onToggleNode: (nodeId: string) => void;
  onRequestChildren: (section: Section, nodeId: string, lazyChildrenKey: string) => void;
  onNodeClick: (section: Section, node: ResourceNodeData) => void;
  onRefresh: (section: Section) => void;
  onCollapseAll: () => void;
}

export function TreeSection({
  title,
  section,
  roots,
  childrenMap,
  expandedNodes,
  expanded,
  createCommand,
  onToggleSection,
  onToggleNode,
  onRequestChildren,
  onNodeClick,
  onRefresh,
  onCollapseAll,
}: TreeSectionProps) {
  // Request roots when section is first expanded
  useEffect(() => {
    if (expanded && roots.length === 0) {
      vscode.postMessage({ type: 'requestRoots', section });
    }
  }, [expanded, roots.length, section]);

  return (
    <div class="tree-section">
      <div class="section-header" onClick={() => onToggleSection(section)}>
        <i class={`codicon codicon-chevron-${expanded ? 'down' : 'right'} section-chevron`} />
        <span class="section-title">{title}</span>
        <div class="section-actions">
          {createCommand && (
            <button
              class="icon-button"
              title={`Create Resource`}
              onClick={(e) => { e.stopPropagation(); vscode.postMessage({ type: 'executeCommand', command: createCommand }); }}
            >
              <i class="codicon codicon-add" />
            </button>
          )}
          <button
            class="icon-button"
            title={`Refresh ${title}`}
            onClick={(e) => { e.stopPropagation(); onRefresh(section); }}
          >
            <i class="codicon codicon-refresh" />
          </button>
          <button
            class="icon-button"
            title="Collapse All"
            onClick={(e) => { e.stopPropagation(); onCollapseAll(); }}
          >
            <i class="codicon codicon-collapse-all" />
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
                expandedNodes={expandedNodes}
                onToggleNode={onToggleNode}
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

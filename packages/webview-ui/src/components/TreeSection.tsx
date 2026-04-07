// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useCallback, useRef } from 'preact/hooks';
import type { ResourceNodeData } from '../types/nodes';
import type { TreeSection as Section } from '../types/protocol';
import { TreeNode, buildNodeId, buildLocalId } from './TreeNode';
import { vscode } from '../hooks/useVscodeApi';

interface TreeSectionProps {
  title: string;
  section: Section;
  roots: ResourceNodeData[];
  childrenMap: Record<string, ResourceNodeData[]>;
  expandedNodes: Set<string>;
  expanded: boolean;
  createCommand?: string;
  selectedNodeId?: string;
  onToggleSection: (section: string) => void;
  onToggleNode: (nodeId: string) => void;
  onRequestChildren: (section: Section, nodeId: string, lazyChildrenKey: string) => void;
  onNodeClick: (section: Section, node: ResourceNodeData) => void;
  onRefresh: (section: Section) => void;
  onCollapseAll: () => void;
  onSelectNode: (nodeId: string) => void;
}

/** Collect all visible nodes with their full path IDs in depth-first order. */
function collectVisibleNodes(
  roots: ResourceNodeData[],
  expandedNodes: Set<string>,
  childrenMap: Record<string, ResourceNodeData[]>,
  parentPath: string = '',
): Array<{ id: string; node: ResourceNodeData }> {
  const result: Array<{ id: string; node: ResourceNodeData }> = [];

  for (const node of roots) {
    const id = buildNodeId(parentPath, node);
    result.push({ id, node });

    if (expandedNodes.has(id)) {
      const children = node.childrenMode === 'preloaded'
        ? node.children
        : childrenMap[id];
      if (children) {
        result.push(...collectVisibleNodes(children, expandedNodes, childrenMap, id));
      }
    }
  }

  return result;
}

export function TreeSection({
  title,
  section,
  roots,
  childrenMap,
  expandedNodes,
  expanded,
  createCommand,
  selectedNodeId,
  onToggleSection,
  onToggleNode,
  onRequestChildren,
  onNodeClick,
  onRefresh,
  onCollapseAll,
  onSelectNode,
}: TreeSectionProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // Request roots when section is first expanded
  useEffect(() => {
    if (expanded && roots.length === 0) {
      vscode.postMessage({ type: 'requestRoots', section });
    }
  }, [expanded, roots.length, section]);

  const scrollToNode = useCallback((nodeId: string) => {
    bodyRef.current
      ?.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, []);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    const visible = collectVisibleNodes(roots, expandedNodes, childrenMap);
    if (visible.length === 0) return;

    const idx = selectedNodeId ? visible.findIndex(v => v.id === selectedNodeId) : -1;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = idx < visible.length - 1 ? idx + 1 : 0;
        onSelectNode(visible[next].id);
        scrollToNode(visible[next].id);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prev = idx > 0 ? idx - 1 : visible.length - 1;
        onSelectNode(visible[prev].id);
        scrollToNode(visible[prev].id);
        break;
      }
      case 'ArrowRight': {
        e.preventDefault();
        if (idx >= 0) {
          const { id, node } = visible[idx];
          const hasChildren = node.childrenMode !== 'none' &&
            !(node.childrenMode === 'preloaded' && (!node.children || node.children.length === 0));
          if (hasChildren && !expandedNodes.has(id)) {
            onToggleNode(id);
          }
        }
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        if (idx >= 0) {
          const { id } = visible[idx];
          if (expandedNodes.has(id)) {
            onToggleNode(id);
          }
        }
        break;
      }
      case 'Enter': {
        e.preventDefault();
        if (idx >= 0) {
          const { node } = visible[idx];
          const nonOpenable = new Set(['no-connection', 'empty', 'component-category', 'infra-category', 'k8s-rendered-release']);
          if (!nonOpenable.has(node.type)) {
            onNodeClick(section, node);
          }
        }
        break;
      }
      case ' ': {
        e.preventDefault();
        if (idx >= 0) {
          onToggleNode(visible[idx].id);
        }
        break;
      }
    }
  }, [roots, expandedNodes, childrenMap, selectedNodeId, section, onSelectNode, onToggleNode, onNodeClick, scrollToNode]);

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

      {expanded && roots.length === 0 && (
        <div class="progress-bar"><div class="progress-bar-indicator" /></div>
      )}
      {expanded && roots.length > 0 && (
        <div
          class="section-body"
          role="tree"
          tabIndex={0}
          ref={bodyRef}
          onKeyDown={onKeyDown}
        >
          {roots.map(node => (
            <TreeNode
              key={buildLocalId(node)}
              node={node}
              section={section}
              depth={0}
              parentPath=""
              childrenMap={childrenMap}
              expandedNodes={expandedNodes}
              selectedNodeId={selectedNodeId}
              onToggleNode={onToggleNode}
              onRequestChildren={onRequestChildren}
              onNodeClick={onNodeClick}
              onSelectNode={onSelectNode}
            />
          ))}
        </div>
      )}
    </div>
  );
}

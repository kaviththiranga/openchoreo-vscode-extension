// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback } from 'preact/hooks';
import type { ResourceNodeData } from '../types/nodes';
import type { TreeSection } from '../types/protocol';
import { resolveNodeIcon } from './icons';

interface TreeNodeProps {
  node: ResourceNodeData;
  section: TreeSection;
  depth: number;
  childrenMap: Record<string, ResourceNodeData[]>;
  onRequestChildren: (section: TreeSection, nodeId: string, lazyChildrenKey: string) => void;
  onNodeClick: (section: TreeSection, node: ResourceNodeData) => void;
}

/** Build a unique node ID for the webview node cache. */
function buildNodeId(node: ResourceNodeData): string {
  const parts: string[] = [node.type];
  if (node.namespace) parts.push(node.namespace);
  if (node.project) parts.push(node.project);
  if (node.component) parts.push(node.component);
  if (node.resourceName) parts.push(node.resourceName);
  // Always include label to ensure uniqueness (e.g., workflow-run-step, infra-category)
  parts.push(node.label);
  return parts.join(':');
}

const NON_CLICKABLE = new Set([
  'no-connection', 'empty', 'component-category', 'infra-category',
  'workflow-run-step', 'k8s-rendered-release',
]);

export function TreeNode({ node, section, depth, childrenMap, onRequestChildren, onNodeClick }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const nodeId = buildNodeId(node);

  const hasChildren = node.childrenMode !== 'none';
  const isLeaf = !hasChildren ||
    (node.childrenMode === 'preloaded' && (!node.children || node.children.length === 0));

  const resolvedChildren = node.childrenMode === 'preloaded'
    ? node.children
    : childrenMap[nodeId];

  const loading = expanded && node.childrenMode === 'lazy' && !resolvedChildren;

  const onToggle = useCallback(() => {
    if (isLeaf) return;
    const next = !expanded;
    setExpanded(next);
    if (next && node.childrenMode === 'lazy' && !resolvedChildren && node.lazyChildrenKey) {
      onRequestChildren(section, nodeId, node.lazyChildrenKey);
    }
  }, [expanded, isLeaf, node, resolvedChildren, section, nodeId, onRequestChildren]);

  const onClick = useCallback(() => {
    if (NON_CLICKABLE.has(node.type)) {
      if (node.type === 'no-connection') {
        onNodeClick(section, node);
      } else {
        // Categories: clicking the row toggles expand/collapse
        onToggle();
      }
      return;
    }
    // Clickable node: open YAML regardless of whether it has children
    onNodeClick(section, node);
  }, [node, section, onNodeClick, onToggle]);

  const { codicon, colorClass } = resolveNodeIcon(node.type, node.statusPhase, node.healthStatus, node.icon);
  const spinning = node.statusPhase === 'Running' || node.healthStatus === 'Progressing';

  // Context data for native VS Code context menus (webview/context)
  // Parse contextValue flags (e.g., "project_editable_deletable_creatable")
  const cv = node.contextValue;
  const contextData = JSON.stringify({
    webviewSection: section,
    nodeType: node.type,
    contextValue: cv,
    nodeId,
    isEditable: cv.includes('_editable'),
    isDeletable: cv.includes('_deletable'),
    isCreatable: cv.includes('_creatable'),
    preventDefaultContextMenuItems: true,
  });

  return (
    <div class="tree-node" role="treeitem" aria-expanded={hasChildren && !isLeaf ? expanded : undefined}>
      <div
        class="tree-row"
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
        data-vscode-context={contextData}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
      >
        {/* Expand/collapse chevron */}
        <span
          class={`tree-chevron ${isLeaf ? 'hidden' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
        >
          <i class={`codicon codicon-chevron-${expanded ? 'down' : 'right'}`} />
        </span>

        {/* Node icon */}
        <i class={`codicon codicon-${codicon} tree-icon ${colorClass} ${spinning ? 'spin' : ''}`} />

        {/* Label */}
        <span class="tree-label">{node.label}</span>

        {/* Description */}
        {node.description && (
          <span class="tree-description">{node.description}</span>
        )}
      </div>

      {/* Children */}
      {expanded && !isLeaf && (
        <div class="tree-children" role="group">
          {loading && (
            <div class="tree-row" style={{ paddingLeft: `${(depth + 1) * 16 + 4}px` }}>
              <i class="codicon codicon-loading spin" />
              <span class="tree-label loading-text">Loading...</span>
            </div>
          )}
          {resolvedChildren?.map(child => (
            <TreeNode
              key={buildNodeId(child)}
              node={child}
              section={section}
              depth={depth + 1}
              childrenMap={childrenMap}
              onRequestChildren={onRequestChildren}
              onNodeClick={onNodeClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect } from 'preact/hooks';
import type { ResourceNodeData } from '../types/nodes';
import type { TreeSection } from '../types/protocol';
import { resolveNodeIcon } from './icons';

interface TreeNodeProps {
  node: ResourceNodeData;
  section: TreeSection;
  depth: number;
  parentPath: string;
  childrenMap: Record<string, ResourceNodeData[]>;
  expandedNodes: Set<string>;
  selectedNodeId?: string;
  onToggleNode: (nodeId: string) => void;
  onRequestChildren: (section: TreeSection, nodeId: string, lazyChildrenKey: string) => void;
  onNodeClick: (section: TreeSection, node: ResourceNodeData) => void;
  onSelectNode: (nodeId: string) => void;
}

/** Build a local segment for this node. */
export function buildLocalId(node: ResourceNodeData): string {
  const parts: string[] = [node.type];
  if (node.namespace) parts.push(node.namespace);
  if (node.project) parts.push(node.project);
  if (node.component) parts.push(node.component);
  if (node.resourceName) parts.push(node.resourceName);
  parts.push(node.label);
  return parts.join(':');
}

/** Build a globally unique node ID by combining parent path with local ID. */
export function buildNodeId(parentPath: string, node: ResourceNodeData): string {
  const local = buildLocalId(node);
  return parentPath ? `${parentPath}/${local}` : local;
}

const NON_CLICKABLE = new Set([
  'no-connection', 'empty', 'component-category', 'infra-category',
  'workflow-run-step', 'k8s-rendered-release',
]);

export function TreeNode({ node, section, depth, parentPath, childrenMap, expandedNodes, selectedNodeId, onToggleNode, onRequestChildren, onNodeClick, onSelectNode }: TreeNodeProps) {
  const nodeId = buildNodeId(parentPath, node);
  const expanded = expandedNodes.has(nodeId);
  const selected = selectedNodeId === nodeId;

  const hasChildren = node.childrenMode !== 'none';
  const isLeaf = !hasChildren ||
    (node.childrenMode === 'preloaded' && (!node.children || node.children.length === 0));

  const resolvedChildren = node.childrenMode === 'preloaded'
    ? node.children
    : childrenMap[nodeId];

  const loading = expanded && node.childrenMode === 'lazy' && !resolvedChildren;

  // Request lazy children when expanded and not yet loaded
  useEffect(() => {
    if (expanded && node.childrenMode === 'lazy' && !resolvedChildren && node.lazyChildrenKey) {
      onRequestChildren(section, nodeId, node.lazyChildrenKey);
    }
  }, [expanded, node.childrenMode, node.lazyChildrenKey, resolvedChildren, section, nodeId, onRequestChildren]);

  const onToggle = useCallback(() => {
    if (isLeaf) return;
    onToggleNode(nodeId);
  }, [isLeaf, nodeId, onToggleNode]);

  const onClick = useCallback(() => {
    onSelectNode(nodeId);
    if (NON_CLICKABLE.has(node.type)) {
      if (node.type === 'no-connection') {
        onNodeClick(section, node);
      } else {
        onToggle();
      }
      return;
    }
    onNodeClick(section, node);
  }, [node, section, nodeId, onNodeClick, onToggle, onSelectNode]);

  const { codicon, colorClass } = resolveNodeIcon(node.type, node.statusPhase, node.healthStatus, node.icon);
  const spinning = node.statusPhase === 'Running' || node.healthStatus === 'Progressing';

  // Context data for native VS Code context menus (webview/context)
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
        class={`tree-row${selected ? ' selected' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
        data-vscode-context={contextData}
        data-node-id={nodeId}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
      >
        {/* Expand/collapse chevron */}
        <span
          class={`tree-chevron ${isLeaf ? 'hidden' : ''}`}
          onClick={(e) => { e.stopPropagation(); onSelectNode(nodeId); onToggle(); }}
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
            <div class="tree-row" style={{ paddingLeft: `${(depth + 1) * 16 + 12}px` }}>
              <i class="codicon codicon-loading spin" />
              <span class="tree-label loading-text">Loading...</span>
            </div>
          )}
          {resolvedChildren?.map(child => (
            <TreeNode
              key={buildLocalId(child)}
              node={child}
              section={section}
              depth={depth + 1}
              parentPath={nodeId}
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

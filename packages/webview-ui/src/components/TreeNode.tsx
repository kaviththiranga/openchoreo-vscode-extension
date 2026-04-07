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
  /** Depth index of a guide that should always be visible (from a selected+expanded ancestor). */
  activeGuideDepth?: number;
  onToggleNode: (nodeId: string) => void;
  onRequestChildren: (section: TreeSection, nodeId: string, lazyChildrenKey: string) => void;
  onNodeClick: (section: TreeSection, node: ResourceNodeData) => void;
  onSelectNode: (nodeId: string) => void;
  iconsBaseUri: string;
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

export function TreeNode({ node, section, depth, parentPath, childrenMap, expandedNodes, selectedNodeId, activeGuideDepth, onToggleNode, onRequestChildren, onNodeClick, onSelectNode, iconsBaseUri }: TreeNodeProps) {
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

  const icon = resolveNodeIcon(node.type, node.statusPhase, node.healthStatus, node.icon);
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

  // Build indent guide elements for this depth
  const guides = [];
  for (let i = 0; i < depth; i++) {
    const isActive = activeGuideDepth !== undefined && i === activeGuideDepth;
    guides.push(<span key={i} class={`indent-guide${isActive ? ' indent-guide-active' : ''}`} />);
  }

  // Determine activeGuideDepth for children:
  // If this node is selected+expanded, its children get this node's depth as active guide.
  // Otherwise, pass through the inherited activeGuideDepth.
  const childActiveGuideDepth = (selected && expanded && !isLeaf)
    ? depth
    : activeGuideDepth;

  return (
    <div class="tree-node" role="treeitem" aria-expanded={hasChildren && !isLeaf ? expanded : undefined}>
      <div
        class={`tree-row${selected ? ' selected' : ''}`}
        style={{ paddingLeft: `${depth === 0 ? 16 : 8}px` }}
        data-vscode-context={contextData}
        data-node-id={nodeId}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
      >
        {guides}

        <span
          class={`tree-chevron ${isLeaf ? 'hidden' : ''}`}
          onClick={(e) => { e.stopPropagation(); onSelectNode(nodeId); onToggle(); }}
        >
          <i class={`codicon codicon-chevron-${expanded ? 'down' : 'right'}`} />
        </span>

        {node.type !== 'component-category' && node.type !== 'infra-category' && (
          icon.kind === 'svg' && iconsBaseUri
            ? <img class="tree-icon-svg" src={`${iconsBaseUri}/${icon.filename}`} alt="" />
            : icon.kind === 'codicon'
              ? <i class={`codicon codicon-${icon.codicon} tree-icon ${icon.colorClass} ${spinning ? 'spin' : ''}`} />
              : null
        )}

        <span class="tree-label">{node.label}</span>

        {node.description && (
          <span class="tree-description">{node.description}</span>
        )}
      </div>

      {expanded && !isLeaf && (
        <div class="tree-children" role="group">
          {loading && (
            <div class="tree-row" style={{ paddingLeft: `${depth === 0 ? 16 : 8}px` }}>
              {Array.from({ length: depth + 1 }, (_, i) => {
                const isActive = childActiveGuideDepth !== undefined && i === childActiveGuideDepth;
                return <span key={i} class={`indent-guide${isActive ? ' indent-guide-active' : ''}`} />;
              })}
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
              activeGuideDepth={childActiveGuideDepth}
              onToggleNode={onToggleNode}
              onRequestChildren={onRequestChildren}
              onNodeClick={onNodeClick}
              onSelectNode={onSelectNode}
              iconsBaseUri={iconsBaseUri}
            />
          ))}
        </div>
      )}
    </div>
  );
}

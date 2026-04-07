// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback } from 'preact/hooks';
import { NamespaceHeader } from './components/NamespaceHeader';
import { TreeSection } from './components/TreeSection';
import { vscode } from './hooks/useVscodeApi';
import type { AuthState, ExtToWebviewMessage, TreeSection as Section } from './types/protocol';
import type { ResourceNodeData } from './types/nodes';

import './styles/sidebar.css';

/** Per-context tree view state. */
interface TreeViewState {
  expandedNodes: string[];
  expandedSections: string[];
  selectedNodeId?: string;
}

/** Top-level persisted state keyed by context:namespace. */
interface PersistedState {
  contextStates: Record<string, TreeViewState>;
  lastContextKey?: string;
}

const DEFAULT_TREE_STATE: TreeViewState = { expandedNodes: [], expandedSections: ['projects'] };

function getContextKey(ctx?: string, ns?: string): string {
  return `${ctx ?? ''}:${ns ?? ''}`;
}

function loadPersistedState(): PersistedState {
  const raw = vscode.getState<Record<string, unknown>>();
  // Handle migration from old format (flat expandedNodes/expandedSections)
  if (raw && 'contextStates' in raw) return raw as unknown as PersistedState;
  return { contextStates: {} };
}

export function App() {
  const [authState, setAuthState] = useState<AuthState>({
    connected: false,
  });
  const [sectionRoots, setSectionRoots] = useState<Record<Section, ResourceNodeData[]>>({
    projects: [],
    infrastructure: [],
    cluster: [],
  });
  const [childrenMap, setChildrenMap] = useState<Record<string, ResourceNodeData[]>>({});
  const [iconFontLoaded, setIconFontLoaded] = useState(false);

  // Persisted expand state — keyed by context:namespace
  const persisted = loadPersistedState();
  const contextKey = getContextKey(authState.contextName, authState.namespace);
  const initialState = persisted.contextStates[contextKey] ?? DEFAULT_TREE_STATE;
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => new Set(initialState.expandedNodes));
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set(initialState.expandedSections));
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(initialState.selectedNodeId);
  const [activeContextKey, setActiveContextKey] = useState(contextKey);

  // When context/namespace changes, swap to that context's persisted state
  useEffect(() => {
    const newKey = getContextKey(authState.contextName, authState.namespace);
    if (newKey !== activeContextKey && authState.connected) {
      const stored = loadPersistedState();
      const state = stored.contextStates[newKey] ?? DEFAULT_TREE_STATE;
      setExpandedNodes(new Set(state.expandedNodes));
      setExpandedSections(new Set(state.expandedSections));
      setSelectedNodeId(state.selectedNodeId);
      setActiveContextKey(newKey);
    }
  }, [authState.contextName, authState.namespace, authState.connected, activeContextKey]);

  // Persist state for current context
  const persistState = useCallback((nodes: Set<string>, sections: Set<string>, selected?: string) => {
    const stored = loadPersistedState();
    stored.contextStates[activeContextKey] = {
      expandedNodes: [...nodes],
      expandedSections: [...sections],
      selectedNodeId: selected,
    };
    stored.lastContextKey = activeContextKey;
    vscode.setState<PersistedState>(stored);
  }, [activeContextKey]);

  const toggleNode = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      persistState(next, expandedSections, selectedNodeId);
      return next;
    });
  }, [expandedSections, selectedNodeId, persistState]);

  const toggleSection = useCallback((section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      persistState(expandedNodes, next, selectedNodeId);
      return next;
    });
  }, [expandedNodes, selectedNodeId, persistState]);

  const selectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    persistState(expandedNodes, expandedSections, nodeId);
  }, [expandedNodes, expandedSections, persistState]);

  const collapseAll = useCallback((section: Section) => {
    // Collect all node IDs that belong to this section's roots
    const roots = sectionRoots[section];
    const sectionIds = new Set<string>();
    const collectIds = (nodes: ResourceNodeData[], parentPath: string) => {
      for (const node of nodes) {
        const parts: string[] = [node.type];
        if (node.namespace) parts.push(node.namespace);
        if (node.project) parts.push(node.project);
        if (node.component) parts.push(node.component);
        if (node.resourceName) parts.push(node.resourceName);
        parts.push(node.label);
        const local = parts.join(':');
        const id = parentPath ? `${parentPath}/${local}` : local;
        sectionIds.add(id);
        // Recurse into expanded children
        if (expandedNodes.has(id)) {
          const children = node.childrenMode === 'preloaded' ? node.children : childrenMap[id];
          if (children) collectIds(children, id);
        }
      }
    };
    collectIds(roots, '');

    setExpandedNodes(prev => {
      const next = new Set(prev);
      for (const id of sectionIds) next.delete(id);
      persistState(next, expandedSections, selectedNodeId);
      return next;
    });
  }, [sectionRoots, childrenMap, expandedNodes, expandedSections, selectedNodeId, persistState]);

  // Handle messages from extension host
  useEffect(() => {
    const handler = (event: MessageEvent<ExtToWebviewMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'setAuthState':
          setAuthState(msg.state);
          break;
        case 'setIconsBaseUri':
          // Inject the custom icon font
          if (msg.fontUri && !iconFontLoaded) {
            const style = document.createElement('style');
            style.textContent = `@font-face { font-family: 'openchoreo-icons'; src: url('${msg.fontUri}') format('woff2'); font-weight: normal; font-style: normal; }`;
            document.head.appendChild(style);
            setIconFontLoaded(true);
          }
          break;
        case 'setRoots':
          setSectionRoots(prev => ({ ...prev, [msg.section]: msg.nodes }));
          break;
        case 'setChildren':
          setChildrenMap(prev => ({ ...prev, [msg.nodeId]: msg.nodes }));
          break;
        case 'refreshAll':
          setChildrenMap({});
          vscode.postMessage({ type: 'requestRoots', section: 'projects' });
          vscode.postMessage({ type: 'requestRoots', section: 'infrastructure' });
          vscode.postMessage({ type: 'requestRoots', section: 'cluster' });
          break;
        case 'refreshSection':
          setChildrenMap({});
          setSectionRoots(prev => ({ ...prev, [msg.section]: [] }));
          vscode.postMessage({ type: 'requestRoots', section: msg.section });
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Signal readiness to extension host
  useEffect(() => {
    vscode.postMessage({ type: 'ready' });
  }, []);

  const onRequestChildren = useCallback(
    (section: Section, nodeId: string, lazyChildrenKey: string) => {
      vscode.postMessage({ type: 'requestChildren', section, nodeId, lazyChildrenKey });
    },
    [],
  );

  const onNodeClick = useCallback(
    (section: Section, node: ResourceNodeData) => {
      vscode.postMessage({ type: 'nodeClicked', section, node });
    },
    [],
  );

  const onRefresh = useCallback(
    (section: Section) => {
      setChildrenMap({});
      setSectionRoots(prev => ({ ...prev, [section]: [] }));
      vscode.postMessage({ type: 'refresh', section });
    },
    [],
  );

  if (!authState.connected) {
    return (
      <div class="sidebar">
        <div class="not-connected">
          <i class="codicon codicon-warning" />
          <span>Not connected to OpenChoreo</span>
          <button
            class="vscode-button"
            onClick={() => vscode.postMessage({ type: 'executeCommand', command: 'openchoreo.login' })}
          >
            Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="sidebar">
      <NamespaceHeader
        namespace={authState.namespace}
        contextName={authState.contextName}
        onSelectNamespace={() => vscode.postMessage({ type: 'selectNamespace' })}
        onSwitchContext={() => vscode.postMessage({ type: 'executeCommand', command: 'openchoreo.switchContext' })}
      />
      <TreeSection
        title="Projects"
        section="projects"
        roots={sectionRoots.projects}
        childrenMap={childrenMap}
        expandedNodes={expandedNodes}
        expanded={expandedSections.has('projects')}
        createCommand="openchoreo.createDevResource"
        onToggleSection={toggleSection}
        onToggleNode={toggleNode}
        onRequestChildren={onRequestChildren}
        onNodeClick={onNodeClick}
        onRefresh={onRefresh}
        onCollapseAll={collapseAll}
        selectedNodeId={selectedNodeId}
        onSelectNode={selectNode}
      />
      <TreeSection
        title="Namespace Resources"
        section="infrastructure"
        roots={sectionRoots.infrastructure}
        childrenMap={childrenMap}
        expandedNodes={expandedNodes}
        expanded={expandedSections.has('infrastructure')}
        createCommand="openchoreo.createInfraResource"
        onToggleSection={toggleSection}
        onToggleNode={toggleNode}
        onRequestChildren={onRequestChildren}
        onNodeClick={onNodeClick}
        onRefresh={onRefresh}
        onCollapseAll={collapseAll}
        selectedNodeId={selectedNodeId}
        onSelectNode={selectNode}
      />
      <TreeSection
        title="Cluster Resources"
        section="cluster"
        roots={sectionRoots.cluster}
        childrenMap={childrenMap}
        expandedNodes={expandedNodes}
        expanded={expandedSections.has('cluster')}
        createCommand="openchoreo.createClusterResource"
        onToggleSection={toggleSection}
        onToggleNode={toggleNode}
        onRequestChildren={onRequestChildren}
        onNodeClick={onNodeClick}
        onRefresh={onRefresh}
        onCollapseAll={collapseAll}
        selectedNodeId={selectedNodeId}
        onSelectNode={selectNode}
      />
    </div>
  );
}

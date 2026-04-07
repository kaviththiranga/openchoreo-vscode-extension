// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback } from 'preact/hooks';
import { NamespaceHeader } from './components/NamespaceHeader';
import { TreeSection } from './components/TreeSection';
import { vscode } from './hooks/useVscodeApi';
import type { AuthState, ExtToWebviewMessage, TreeSection as Section } from './types/protocol';
import type { ResourceNodeData } from './types/nodes';

import './styles/sidebar.css';

/** State persisted across webview hide/show via vscode.getState/setState. */
interface PersistedState {
  expandedNodes: string[];
  expandedSections: string[];
}

function loadPersistedState(): PersistedState {
  return vscode.getState<PersistedState>() ?? { expandedNodes: [], expandedSections: ['projects'] };
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

  // Persisted expand state
  const persisted = loadPersistedState();
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => new Set(persisted.expandedNodes));
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set(persisted.expandedSections));

  // Persist state whenever it changes
  const persistState = useCallback((nodes: Set<string>, sections: Set<string>) => {
    vscode.setState<PersistedState>({
      expandedNodes: [...nodes],
      expandedSections: [...sections],
    });
  }, []);

  const toggleNode = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      persistState(next, expandedSections);
      return next;
    });
  }, [expandedSections, persistState]);

  const toggleSection = useCallback((section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      persistState(expandedNodes, next);
      return next;
    });
  }, [expandedNodes, persistState]);

  // Handle messages from extension host
  useEffect(() => {
    const handler = (event: MessageEvent<ExtToWebviewMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'setAuthState':
          setAuthState(msg.state);
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
      />
      <TreeSection
        title="Projects"
        section="projects"
        roots={sectionRoots.projects}
        childrenMap={childrenMap}
        expandedNodes={expandedNodes}
        expanded={expandedSections.has('projects')}
        onToggleSection={toggleSection}
        onToggleNode={toggleNode}
        onRequestChildren={onRequestChildren}
        onNodeClick={onNodeClick}
        onRefresh={onRefresh}
      />
      <TreeSection
        title="Namespace Resources"
        section="infrastructure"
        roots={sectionRoots.infrastructure}
        childrenMap={childrenMap}
        expandedNodes={expandedNodes}
        expanded={expandedSections.has('infrastructure')}
        onToggleSection={toggleSection}
        onToggleNode={toggleNode}
        onRequestChildren={onRequestChildren}
        onNodeClick={onNodeClick}
        onRefresh={onRefresh}
      />
      <TreeSection
        title="Cluster Resources"
        section="cluster"
        roots={sectionRoots.cluster}
        childrenMap={childrenMap}
        expandedNodes={expandedNodes}
        expanded={expandedSections.has('cluster')}
        onToggleSection={toggleSection}
        onToggleNode={toggleNode}
        onRequestChildren={onRequestChildren}
        onNodeClick={onNodeClick}
        onRefresh={onRefresh}
      />
    </div>
  );
}

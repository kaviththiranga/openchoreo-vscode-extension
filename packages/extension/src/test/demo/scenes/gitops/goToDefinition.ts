// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import { activeEditor, activeTab, editorToken, hideCursor, hold, modClick, parkMouse, showFiles, tab } from './ui';
import { resetWorkspace } from './workspace';

/**
 * Go to Definition on references in repository YAML: greeter's componentType
 * jumps to the ClusterComponentType declared in the repository; its workflow,
 * declared nowhere in the repository, opens read-only from the cluster.
 * Needs the extension's own definitions, i.e. the bundled language server
 * (openchoreo.languageServer "bundled", or an occ without `occ lsp`).
 */
export const goToDefinition: Scene = {
  name: 'go-to-definition',
  title: 'Go to Definition on references in GitOps YAML: to the declaring file in the repository, or the cluster copy',
  requires: ['cluster', 'gitops-workspace'],
  teardown: async () => resetWorkspace(),
  async setup(demo) {
    resetWorkspace();
    await showFiles(demo, 420);
    await demo.openFile('greeter/component.yaml');
    await activeTab(demo.page, 'component.yaml');
    await parkMouse(demo.page);
  },
  async run(demo) {
    const page = demo.page;
    await demo.pause(800);
    await modClick(demo, editorToken(page, 'deployment/service'));
    await activeTab(page, 'service.yaml');
    await editorToken(page, 'ClusterComponentType').waitFor({ timeout: 30_000 });
    await parkMouse(page);
    await demo.pause(300); // let the recording catch up with the paint
    await demo.mark('key', activeEditor(page));
    await hold(demo, 'declared-in-repository', 1600);

    await demo.click(tab(page, 'component.yaml'));
    await activeTab(page, 'component.yaml');
    await demo.pause(500);
    await demo.click(editorToken(page, 'dockerfile-builder'));
    await demo.pause(300);
    await demo.press('F12');
    await activeTab(page, 'dockerfile-builder.yaml');
    await editorToken(page, 'ClusterWorkflow').waitFor({ timeout: 30_000 });
    await hideCursor(demo);
    await demo.pause(300);
    await demo.mark('cluster-copy', activeEditor(page));
    await hold(demo, 'from-the-cluster', 1800);
  },
};

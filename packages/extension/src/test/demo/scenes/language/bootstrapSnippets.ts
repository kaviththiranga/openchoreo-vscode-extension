// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import {
  closePanel, explorerLayout, holdWithStill, newLine, openWorkspaceFile, resetWorkspace, selectSuggestion, suggestion,
  suggestWidget, typeAndAccept, waitForSuggestions, workspaceLine, writeWorkspaceFile,
} from './helpers';

const QA = 'environments/qa.yaml';

/**
 * An empty file to a complete Environment: the oc-* scaffolds, then the spec
 * from completions with the data plane listed from the cluster.
 *   DEMO_WITH=cluster DEMO_WORKSPACE=<language>/platform-config
 */
export const bootstrapSnippets: Scene = {
  name: 'bootstrap-snippets',
  title: 'From an empty file to a complete Environment with the oc-* scaffolds and completions',
  requires: ['cluster'],
  async setup(demo) {
    resetWorkspace();
    writeWorkspaceFile(QA, ['']);
    await closePanel(demo);
    await explorerLayout(demo, { files: true, outline: true, outlineTop: 330 });
    // The data planes arrive with the rest of the cluster's names.
    await openWorkspaceFile(demo, 'environments/development.yaml');
    await waitForSuggestions(demo, workspaceLine('environments/development.yaml', '    name: default'), 11, 'default');
    await demo.command('View: Close All Editors');
    await openWorkspaceFile(demo, QA);
  },
  async run(demo) {
    const widget = suggestWidget(demo);
    // Every scaffold the empty file offers.
    await demo.press('Control+Space');
    await suggestion(demo, 'oc-environment').waitFor({ timeout: 10_000 });
    await demo.pause(300);
    await demo.mark('key', widget);
    await holdWithStill(demo, 'scaffolds', 1000);
    await typeAndAccept(demo, 'env', 'oc-environment', 120);
    await demo.page.locator('.monaco-editor .view-line', { hasText: 'kind: Environment' }).first().waitFor();
    await demo.pause(700);
    await demo.type('qa', 120);
    await demo.page.keyboard.press('Tab');
    await demo.pause(400);
    await demo.page.keyboard.press('Tab');
    await demo.pause(500);

    // The spec, from the Environment schema and the cluster.
    await typeAndAccept(demo, 'dat', 'dataPlaneRef', 90);
    await typeAndAccept(demo, 'k', 'kind', 90);
    await selectSuggestion(demo, 'ClusterDataPlane');
    await newLine(demo, 4);
    await demo.type('name: ', 70);
    await suggestion(demo, 'default').waitFor();
    await demo.pause(300);
    await demo.mark('cluster', widget);
    await holdWithStill(demo, 'data-planes', 700);
    await selectSuggestion(demo, 'default');
    await newLine(demo, 2);
    await typeAndAccept(demo, 'isP', 'isProduction', 110);
    await suggestion(demo, 'false').waitFor();
    await demo.pause(400);
    await selectSuggestion(demo, 'false');
    await demo.pause(600);
    await holdWithStill(demo, 'done', 800);
  },
};

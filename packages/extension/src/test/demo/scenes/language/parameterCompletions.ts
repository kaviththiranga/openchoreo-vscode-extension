// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import {
  closePanel, explorerLayout, holdWithStill, newLine, openWorkspaceFile, resetWorkspace, selectSuggestion, suggestion,
  suggestWidget, typeAndAccept, waitForSuggestions, writeWorkspaceFile,
} from './helpers';
import { QR_SERVICE, QR_SERVICE_HEADER } from './smartCompletions';

/**
 * A trait's parameters offered from its schema on the cluster, defaults
 * included; picks up where smart-completions ends.
 *   DEMO_WITH=cluster DEMO_WORKSPACE=<language>/url-shortener
 */
export const parameterCompletions: Scene = {
  name: 'parameter-completions',
  title: "Trait parameters completed from the trait's schema on the cluster, with its defaults",
  requires: ['cluster'],
  async setup(demo) {
    resetWorkspace();
    writeWorkspaceFile(QR_SERVICE, [
      ...QR_SERVICE_HEADER,
      '  componentType:',
      '    kind: ClusterComponentType',
      '    name: deployment/service',
      '  traits:',
      '    - name: horizontal-pod-autoscaler',
      '      kind: ClusterTrait',
      '      instanceName: autoscaler',
    ]);
    await closePanel(demo);
    await explorerLayout(demo, { files: true, outline: false });
    await openWorkspaceFile(demo, QR_SERVICE);
    await waitForSuggestions(demo, 8, 18, 'url-shortener');
    await demo.goTo(15, 31);
  },
  async run(demo) {
    const widget = suggestWidget(demo);
    await newLine(demo, 6);
    await typeAndAccept(demo, 'par', 'parameters', 90);
    await newLine(demo, 8);
    await demo.press('Control+Space');
    await suggestion(demo, 'targetUtilization').waitFor();
    await demo.pause(300);
    await demo.mark('parameters', widget);
    await holdWithStill(demo, 'trait-parameters', 800);
    await selectSuggestion(demo, 'replicas');
    await demo.press('Control+Space');
    await suggestion(demo, 'max').waitFor();
    await demo.pause(300);
    await demo.mark('key', widget);
    await holdWithStill(demo, 'defaults', 1200);
    await selectSuggestion(demo, 'max');
    await newLine(demo, 10);
    await demo.press('Control+Space');
    await suggestion(demo, 'min').waitFor();
    await demo.pause(600);
    await selectSuggestion(demo, 'min');
    await demo.pause(600);
    await holdWithStill(demo, 'done', 800);
  },
};

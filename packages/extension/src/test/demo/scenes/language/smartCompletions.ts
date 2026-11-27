// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import {
  closePanel, explorerLayout, holdWithStill, newLine, openWorkspaceFile, resetWorkspace, selectSuggestion, suggestion,
  suggestWidget, typeAndAccept, waitForSuggestions, writeWorkspaceFile,
} from './helpers';

/** The Component both completion scenes write, in the url-shortener workspace. */
export const QR_SERVICE = 'openchoreo/components/qr-service.yaml';

export const QR_SERVICE_HEADER = [
  'apiVersion: openchoreo.dev/v1alpha1',
  'kind: Component',
  'metadata:',
  '  name: snip-qr-service',
  '  namespace: default',
  'spec:',
  '  owner:',
  '    projectName: url-shortener',
];

/**
 * Writing a Component: schema keys and enum values, then component types and
 * traits listed from the live cluster.
 *   DEMO_WITH=cluster DEMO_WORKSPACE=<language>/url-shortener
 */
export const smartCompletions: Scene = {
  name: 'smart-completions',
  title: 'Writing a Component: schema keys, enum values, and component types and traits from the live cluster',
  requires: ['cluster'],
  async setup(demo) {
    resetWorkspace();
    writeWorkspaceFile(QR_SERVICE, [...QR_SERVICE_HEADER, '  ']);
    await closePanel(demo);
    await explorerLayout(demo, { files: true, outline: false });
    await openWorkspaceFile(demo, QR_SERVICE);
    // The project list arrives with the rest of the cluster's names.
    await waitForSuggestions(demo, 8, 18, 'url-shortener');
    await demo.goTo(9, 3);
  },
  async run(demo) {
    const widget = suggestWidget(demo);
    // Keys from the Component schema.
    await demo.press('Control+Space');
    await suggestion(demo, 'componentType').waitFor();
    await holdWithStill(demo, 'schema-keys', 700);
    await selectSuggestion(demo, 'componentType');

    // A nested key and its enum values.
    await typeAndAccept(demo, 'k', 'kind', 90);
    await selectSuggestion(demo, 'ClusterComponentType');
    await newLine(demo, 4);

    // Component types on the cluster, as workloadType/name.
    await demo.type('name: ', 60);
    await suggestion(demo, 'deployment/service').waitFor();
    await demo.pause(300);
    await demo.mark('key', widget);
    await holdWithStill(demo, 'component-types', 1100);
    await selectSuggestion(demo, 'deployment/service');
    await newLine(demo, 2);

    // Traits on the cluster.
    await typeAndAccept(demo, 'tr', 'traits', 90);
    await demo.type('name: ', 60);
    await suggestion(demo, 'horizontal-pod-autoscaler').waitFor();
    await demo.pause(300);
    await demo.mark('traits', widget);
    await holdWithStill(demo, 'traits', 700);
    await typeAndAccept(demo, 'hor', 'horizontal-pod-autoscaler', 100);
    await newLine(demo, 6);
    await typeAndAccept(demo, 'k', 'kind', 90);
    await selectSuggestion(demo, 'ClusterTrait');
    await newLine(demo, 6);
    await typeAndAccept(demo, 'ins', 'instanceName', 90);
    await demo.type('autoscaler', 50);
    await demo.page.keyboard.press('Escape');
    await demo.pause(500);
    await holdWithStill(demo, 'done', 900);
  },
};

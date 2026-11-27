// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import {
  closePanel, explorerLayout, holdWithStill, moveToLineEnd, openWorkspaceFile, resetWorkspace, selectSuggestion,
  suggestion, suggestWidget, typeAndAccept, writeWorkspaceFile,
} from './helpers';

const TRAIT = 'traits/pod-disruption-budget.yaml';

/** The trait being written; the scene types the template's name and minAvailable. */
const TRAIT_LINES = [
  'apiVersion: openchoreo.dev/v1alpha1',
  'kind: ClusterTrait',
  'metadata:',
  '  name: pod-disruption-budget',
  'spec:',
  '  parameters:',
  '    openAPIV3Schema:',
  '      type: object',
  '      properties:',
  '        minAvailable:',
  '          type: integer',
  '          default: 1',
  '          minimum: 0',
  '        maxUnavailable:',
  '          type: integer',
  '          minimum: 0',
  '',
  '  creates:',
  '    - template:',
  '        apiVersion: policy/v1',
  '        kind: PodDisruptionBudget',
  '        metadata:',
  '          name: ',
  '          namespace: ${metadata.namespace}',
  '          labels: ${metadata.labels}',
  '        spec:',
  '          minAvailable: ',
  '          selector:',
  '            matchLabels: ${metadata.podSelectors}',
];

const line = (prefix: string) => TRAIT_LINES.findIndex((l) => l.startsWith(prefix)) + 1;

/**
 * CEL in a trait template: the context variables and oc_* functions, member
 * completion, and parameters from the trait's own schema.
 *   DEMO_WORKSPACE=<language>/platform-config
 */
export const celCompletions: Scene = {
  name: 'cel-completions',
  title: "CEL in a trait template: context variables, oc_* functions and the trait's own parameters",
  requires: ['workspace'],
  async setup(demo) {
    resetWorkspace();
    writeWorkspaceFile(TRAIT, TRAIT_LINES);
    await closePanel(demo);
    await explorerLayout(demo, { files: true, outline: false });
    await openWorkspaceFile(demo, TRAIT);
    await demo.goTo(line('          name: '), 17);
  },
  async run(demo) {
    const page = demo.page;
    const widget = suggestWidget(demo);
    // `${` lists the context variables and functions; oc_ narrows to OpenChoreo's own.
    await demo.type('${', 110);
    await suggestion(demo, 'configurations').waitFor({ timeout: 10_000 });
    await demo.pause(600);
    await demo.type('oc_', 100);
    await suggestion(demo, 'oc_generate_name').waitFor();
    await demo.pause(300);
    await demo.mark('functions', widget);
    await holdWithStill(demo, 'functions', 700);
    await typeAndAccept(demo, 'ge', 'oc_generate_name', 100);
    await demo.pause(300);
    await page.keyboard.press('Tab');
    await demo.pause(300);
    // Members of a context variable.
    await typeAndAccept(demo, 'trait.ins', 'instanceName', 90);
    await demo.pause(400);

    // The trait's own parameters, from its openAPIV3Schema above.
    await moveToLineEnd(demo, line('          minAvailable: ') - line('          name: '));
    await demo.type('${parameters.', 70);
    await suggestion(demo, 'minAvailable').waitFor({ timeout: 10_000 });
    await demo.pause(300);
    await demo.mark('key', widget);
    await holdWithStill(demo, 'parameters', 1200);
    await selectSuggestion(demo, 'minAvailable');
    await demo.pause(600);
    await holdWithStill(demo, 'done', 700);
  },
};

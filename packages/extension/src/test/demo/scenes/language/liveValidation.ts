// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import {
  editorToken, explorerLayout, glide, holdWithStill, hover, hoverWidget, newLine, openWorkspaceFile, resetWorkspace,
  sizeProblemsPanel, waitForSuggestions, writeWorkspaceFile,
} from './helpers';

const BINDING = 'openchoreo/bindings/snip-api-service-production.yaml';

/**
 * Mistakes flagged as you type: a component the cluster doesn't have, a
 * misspelled field and a value outside the enum, then the Problems panel.
 *   DEMO_WITH=cluster DEMO_WORKSPACE=<language>/url-shortener
 */
export const liveValidation: Scene = {
  name: 'live-validation',
  title: 'Mistakes flagged as you type: an unknown component, a misspelled field and an invalid value',
  requires: ['cluster'],
  async setup(demo) {
    resetWorkspace();
    writeWorkspaceFile(BINDING, [
      'apiVersion: openchoreo.dev/v1alpha1',
      'kind: ReleaseBinding',
      'metadata:',
      '  name: snip-api-service-production',
      '  namespace: default',
      'spec:',
      '  owner:',
      '    projectName: url-shortener',
    ]);
    await sizeProblemsPanel(demo, 230);
    await explorerLayout(demo, { files: true, outline: false });
    await openWorkspaceFile(demo, BINDING);
    await waitForSuggestions(demo, 8, 18, 'url-shortener');
    await demo.goTo(8, 31);
  },
  async run(demo) {
    const page = demo.page;
    await newLine(demo, 4);
    await demo.type('componentName: snip-api', 55);
    await page.keyboard.press('Escape');
    await page.locator('.monaco-editor .squiggly-warning').first().waitFor({ timeout: 10_000 });
    await demo.pause(500);
    await newLine(demo, 2);
    await demo.type('enviroment: production', 55);
    await page.keyboard.press('Escape');
    await demo.pause(500);
    await newLine(demo, 2);
    await demo.type('state: Paused', 55);
    await page.keyboard.press('Escape');
    await demo.pause(600);

    await hover(demo, editorToken(demo, 'enviroment:', 'enviroment'));
    const tooltip = hoverWidget(demo, 'Unknown property');
    await tooltip.waitFor({ timeout: 10_000 });
    await demo.mark('hover', tooltip);
    await holdWithStill(demo, 'hover', 1200);
    await glide(demo, 1150, 420);

    await demo.press('Mod+Shift+M');
    const problems = page.locator('.markers-panel');
    await problems.locator('.monaco-list-row', { hasText: 'not found' }).first().waitFor({ timeout: 10_000 });
    await demo.pause(300);
    await demo.mark('key', problems);
    await holdWithStill(demo, 'problems', 1700);
  },
};

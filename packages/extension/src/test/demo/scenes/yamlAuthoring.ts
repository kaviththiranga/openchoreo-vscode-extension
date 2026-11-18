// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../demo';

/** CRD editing with completions, hover docs and validation. Needs no cluster. */
export const yamlAuthoring: Scene = {
  name: 'yaml-authoring',
  title: 'Editing OpenChoreo YAML: schema completions, hover docs, and validation of a typo',
  async run(demo) {
    await demo.openFile('project.yaml');
    await demo.caption('Schema-aware completions for every OpenChoreo kind');
    await demo.goTo(12);
    await demo.type('  ');
    await demo.press('Control+Space');
    await demo.pause(1500);
    await demo.screenshot('completions');
    await demo.page.keyboard.press('Escape');
    await demo.page.keyboard.press('Control+Z');

    await demo.caption('Field documentation on hover');
    await demo.goTo(10, 6);
    await demo.press('Control+K');
    await demo.press('Control+I');
    await demo.pause(1500);
    await demo.screenshot('hover');
    await demo.page.keyboard.press('Escape');

    await demo.caption('Mistakes are flagged as you type');
    await demo.openFile('workload-typo.yaml');
    await demo.pause(2000);
    await demo.goTo(12, 5);
    await demo.press('F8');
    await demo.pause(1500);
    await demo.screenshot('validation');
    await demo.page.keyboard.press('Escape');
    await demo.pause(600);
  },
};

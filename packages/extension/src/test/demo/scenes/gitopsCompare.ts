// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../demo';

/** A GitOps file next to what the cluster runs. Needs a session that can read the default Environment. */
export const gitopsCompare: Scene = {
  name: 'gitops-compare',
  title: 'GitOps repository vs. cluster: Compare with Cluster on a declared Environment',
  requires: ['cluster'],
  async run(demo) {
    await demo.openFile('gitops/environments/development.yaml');
    await demo.caption('Your GitOps repository, next to what the cluster runs');
    await demo.command('OpenChoreo: Compare with Cluster');
    await demo.page.locator('.monaco-diff-editor').first().waitFor({ timeout: 30_000 });
    await demo.pause(2500);
    await demo.screenshot('compare-with-cluster');
    await demo.pause(800);
  },
};

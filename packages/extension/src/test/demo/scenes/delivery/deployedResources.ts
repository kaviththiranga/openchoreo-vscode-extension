// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import { DEPLOYED } from './data';
import { maximizeNextPanel, outputView, Sidebar } from './sidebar';

/**
 * A release binding opens into the Kubernetes resources it deployed, with
 * health, down to the pod, and the pod's logs stream into the Output panel.
 */
export const deployedResources: Scene = {
  name: 'deployed-resources',
  title: 'Deployed Resource Tree: Deployment → ReplicaSet → Pod with health, then live pod logs',
  requires: ['cluster'],
  async setup(demo) {
    await maximizeNextPanel(demo);
    const sb = new Sidebar(demo);
    // Wide enough that the kinds aren't cut off by the long resource names.
    const comp = await sb.showComponent(DEPLOYED.project, DEPLOYED.component, ['Release Bindings'], 700);
    // Warm the binding's resource tree once, then fold it again.
    await sb.expand(DEPLOYED.environment, comp);
    await sb.collapse(DEPLOYED.environment, comp);
  },
  async run(demo) {
    const sb = new Sidebar(demo);
    const comp = sb.node(DEPLOYED.component);
    const env = await sb.expand(DEPLOYED.environment, comp, true);
    await demo.pause(900);
    const deployment = await sb.expand('Deployment', env, true);
    await demo.pause(500);
    const replicaSet = await sb.expand('ReplicaSet', deployment, true);
    const pod = sb.row('Pod', replicaSet);
    await pod.waitFor();
    await demo.pause(900);
    await demo.mark('key', env);
    await demo.screenshot('resource-tree');

    await sb.menu(pod, 'View Pod Logs');
    const output = outputView(demo.page);
    await output.locator('.view-line', { hasText: /\S/ }).first().waitFor({ timeout: 20_000 });
    await demo.pause(1800);
    await demo.mark('result', output);
    await demo.screenshot('pod-logs');
    await demo.pause(800);
  },
};

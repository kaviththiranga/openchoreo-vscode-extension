// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as fs from 'fs';
import * as path from 'path';
import type { Scene } from '../../demo';
import { activeTab, answerQuickInput, checkSync, expandGitOpsRows, gitopsAction, gitopsRow, gitopsTree, hideCursor, hold, parkMouse, showGitOpsView, toastButton } from './ui';
import { resetWorkspace, WORKLOAD, workspaceRoot } from './workspace';

/** 1-based line and column just after `marker` in a workspace file. */
function positionAfter(file: string, marker: string): { line: number; column: number } {
  const lines = fs.readFileSync(path.join(workspaceRoot(), file), 'utf8').split('\n');
  const line = lines.findIndex((l) => l.includes(marker));
  if (line < 0) throw new Error(`${marker} not found in ${file}`);
  return { line: line + 1, column: lines[line].indexOf(marker) + marker.length + 1 };
}

/**
 * Generate Releases in Repository: a new image tag in greeter's Workload, then
 * occ (file-system mode) renders a new ComponentRelease into the repository,
 * ready to commit. The setup's reset removes the generated file.
 */
export const gitopsGenerateReleases: Scene = {
  name: 'gitops-generate-releases',
  title: 'Generate Releases in Repository: occ renders a ComponentRelease for the new image into the GitOps repository',
  requires: ['cluster', 'gitops-workspace'],
  teardown: async () => resetWorkspace(),
  async setup(demo) {
    const page = demo.page;
    resetWorkspace();
    await showGitOpsView(demo, 520);
    await gitopsRow(page, 'ComponentRelease').waitFor({ timeout: 30_000 });
    await checkSync(demo);
    await expandGitOpsRows(page, ['(cluster-scoped)', 'Component', 'DeploymentPipeline', 'Environment', 'Project', 'ProjectReleaseBinding', 'ReleaseBinding'], false);
    await expandGitOpsRows(page, ['ComponentRelease', 'Workload']);
    await gitopsRow(page, 'cart').waitFor({ state: 'detached', timeout: 15_000 });
    await demo.openFile('greeter/workload.yaml');
    await activeTab(page, 'workload.yaml');
    await parkMouse(page);
  },
  async run(demo) {
    const page = demo.page;
    await demo.pause(600);
    // A new image is out.
    const tag = positionAfter(WORKLOAD, 'greeter-service:');
    await demo.goTo(tag.line, tag.column);
    await page.keyboard.press('Shift+End');
    await demo.pause(300);
    await demo.type('v1.2.0', 70);
    await demo.pause(400);
    await demo.press('Mod+S');
    await demo.pause(900);

    await demo.click(gitopsAction(page, 'Generate Releases in Repository'));
    await parkMouse(page);
    await answerQuickInput(demo, { filter: 'greeter' });
    const commit = toastButton(page, 'Commit on a New Branch');
    await commit.waitFor({ timeout: 60_000 });
    const release = gitopsTree(page).locator('.monaco-list-row', { has: page.locator('.codicon-cloud-upload') }).first();
    await release.waitFor({ timeout: 30_000 });
    await hideCursor(demo);
    await demo.mark('key', release);
    await hold(demo, 'release-generated', 1800);
  },
};

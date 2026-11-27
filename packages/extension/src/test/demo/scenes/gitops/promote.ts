// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import { activeTab, answerQuickInput, checkSync, expandGitOpsRows, gitopsAction, gitopsRow, hideCursor, hold, parkMouse, showGitOpsView, toastButton } from './ui';
import { resetWorkspace } from './workspace';

/**
 * Promote in Repository: occ (file-system mode) writes the staging
 * ReleaseBinding into the repository, the GitOps view shows it is not on the
 * cluster yet, and it is committed on a new branch with "Push and Open Pull
 * Request" offered (never clicked: the workspace can't push). The setup's
 * reset deletes the branch, so the scene repeats.
 */
export const gitopsPromote: Scene = {
  name: 'gitops-promote',
  title: 'Promote in Repository: occ writes the staging ReleaseBinding, committed on a new branch, ready for a pull request',
  requires: ['cluster', 'gitops-workspace'],
  teardown: async () => resetWorkspace(),
  async setup(demo) {
    const page = demo.page;
    resetWorkspace();
    await showGitOpsView(demo, 560);
    await gitopsRow(page, 'ReleaseBinding').waitFor({ timeout: 30_000 });
    await checkSync(demo);
    await expandGitOpsRows(page, ['(cluster-scoped)', 'Component', 'ComponentRelease', 'DeploymentPipeline', 'Environment', 'Project', 'ProjectReleaseBinding', 'Workload'], false);
    await expandGitOpsRows(page, ['ReleaseBinding']);
    // No focus outline on the row just expanded.
    await demo.command('View: Focus Active Editor Group');
    await parkMouse(page);
  },
  async run(demo) {
    const page = demo.page;
    await demo.pause(600);
    await demo.click(gitopsAction(page, 'Promote in Repository'));
    await parkMouse(page);
    await answerQuickInput(demo, { filter: 'staging' });
    await answerQuickInput(demo, { filter: 'greeter' });
    const commit = toastButton(page, 'Commit on a New Branch');
    await commit.waitFor({ timeout: 60_000 });
    await activeTab(page, 'greeter-staging.yaml');
    await gitopsRow(page, 'greeter-staging').locator('.codicon-cloud-upload').waitFor({ timeout: 30_000 });
    await demo.mark('key', gitopsRow(page, 'greeter-staging'));
    await hold(demo, 'promoted', 1300);

    await demo.click(commit);
    await answerQuickInput(demo, { value: /^promote\// });
    await answerQuickInput(demo, { value: /^chore: promote/ });
    const push = toastButton(page, 'Push and Open Pull Request');
    await push.waitFor({ timeout: 30_000 });
    await hideCursor(demo);
    await demo.mark('result', push);
    await hold(demo, 'committed', 1800);
  },
};

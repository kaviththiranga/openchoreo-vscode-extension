// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { commitFiles } from '../scaffolder/writer';

describe('commitFiles', () => {
  it('stages file paths, which is what the git API expects, then commits', async () => {
    const repo = { add: vi.fn(async (_paths: string[]) => {}), commit: vi.fn(async (_message: string) => {}) };
    await commitFiles(repo, [vscode.Uri.file('/w/.openchoreo/component.yaml'), vscode.Uri.file('/w/.openchoreo/workload.yaml')], 'chore: add manifests');
    expect(repo.add).toHaveBeenCalledWith(['/w/.openchoreo/component.yaml', '/w/.openchoreo/workload.yaml']);
    expect(repo.commit).toHaveBeenCalledWith('chore: add manifests');
    expect(repo.add.mock.invocationCallOrder[0]).toBeLessThan(repo.commit.mock.invocationCallOrder[0]);
  });
});

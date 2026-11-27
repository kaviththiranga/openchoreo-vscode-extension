// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { terminalBinary } from '../cli/terminalPath';
import { tildify } from '../workspace/cloneSource';
import { folderLabel } from '../workspace/linkedComponentCommands';

describe('paths shown on screen', () => {
  afterEach(() => vi.restoreAllMocks());

  it('runs occ by name in terminals when its folder is on the terminal PATH', () => {
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ get: () => true } as never);
    expect(terminalBinary('/Users/someone/tools/occ')).toBe('occ');
    expect(terminalBinary('occ')).toBe('occ');
  });

  it('keeps the full path when the folder is not added to PATH', () => {
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ get: () => false } as never);
    expect(terminalBinary('/Users/someone/tools/occ')).toBe('/Users/someone/tools/occ');
  });

  it('writes the home folder as ~', () => {
    const home = os.homedir();
    expect(tildify(path.join(home, 'src', 'sample-workloads'))).toBe(`~${path.sep}src${path.sep}sample-workloads`);
    expect(tildify(`${home}-other/x`)).toBe(`${home}-other/x`);
    expect(tildify('/opt/repos/x')).toBe('/opt/repos/x');
  });

  it('labels a folder by its workspace-relative path, else by its name', () => {
    expect(folderLabel('/Users/someone/src/repo/service', 'repo/service')).toBe('repo/service');
    // VS Code returns the absolute path unchanged for a workspace folder itself.
    expect(folderLabel('/Users/someone/src/repo/service', '/Users/someone/src/repo/service')).toBe('service');
  });
});

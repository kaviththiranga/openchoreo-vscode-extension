// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { getOccBinaryPath } from '../cli/cliPath';
import { resolveOccAsset, managedBinaryPath } from '../cli/manifest';
vi.mock('../cli/manifest', () => ({ resolveOccAsset: vi.fn(), managedBinaryPath: vi.fn() }));

describe('CLI path precedence', () => {
  afterEach(() => vi.restoreAllMocks());
  it('uses an explicit path with spaces and a Windows executable suffix', () => {
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ get: () => 'C:\\custom path\\occ.exe' } as never);
    expect(getOccBinaryPath({} as vscode.ExtensionContext)).toBe('C:\\custom path\\occ.exe');
  });
  it('prefers an existing managed executable over PATH', () => {
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ get: () => '' } as never);
    vi.mocked(resolveOccAsset).mockReturnValue({} as never);
    vi.mocked(managedBinaryPath).mockReturnValue(process.execPath);
    expect(getOccBinaryPath({} as vscode.ExtensionContext)).toBe(process.execPath);
  });
  it('falls back to PATH without an override or managed asset', () => {
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ get: () => '' } as never);
    vi.mocked(resolveOccAsset).mockReturnValue(undefined);
    expect(getOccBinaryPath({} as vscode.ExtensionContext)).toBe('occ');
  });
});

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { registerChatHandoffs } from '../ai/chatHandoffs';

let aiDisabled = false;
vi.mock('vscode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vscode')>();
  return {
    ...actual,
    workspace: { getConfiguration: (section: string) => ({ get: (key: string, fallback: unknown) => (section === 'chat' && key === 'disableAIFeatures' ? aiDisabled : fallback) }) },
    languages: { registerCodeActionsProvider: vi.fn(() => ({ dispose() {} })) },
    CodeAction: class { constructor(readonly title: string) {} },
    CodeActionKind: { QuickFix: 'quickfix' },
  };
});

describe('Fix with Copilot quick fix', () => {
  it('is offered for OpenChoreo diagnostics unless AI features are turned off', () => {
    registerChatHandoffs({ subscriptions: [] } as unknown as vscode.ExtensionContext, () => undefined);
    const provider = vi.mocked(vscode.languages.registerCodeActionsProvider).mock.calls[0][1];
    const ctx = { diagnostics: [{ source: 'openchoreo', message: 'x' }] } as unknown as vscode.CodeActionContext;
    const actions = () => provider.provideCodeActions({ uri: {} } as vscode.TextDocument, {} as vscode.Range, ctx, {} as vscode.CancellationToken) as vscode.CodeAction[];
    expect(actions().map((a) => a.title)).toEqual(['Fix with Copilot']);
    aiDisabled = true;
    expect(actions()).toEqual([]);
  });
});

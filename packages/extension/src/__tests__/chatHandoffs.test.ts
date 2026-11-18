// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';
import { fixPrompt, troubleshootPrompt } from '../ai/chatHandoffs';
import { logSummaryPrompt } from '../ai/logSummary';
import type { ResourceNodeData } from '../treeView/types';

const node = (over: Partial<ResourceNodeData>): ResourceNodeData => ({
  label: 'x',
  type: 'workflow-run',
  contextValue: 'workflow-run',
  childrenMode: 'none',
  namespace: 'default',
  project: 'shop',
  component: 'api',
  ...over,
});

describe('troubleshootPrompt', () => {
  it('asks why a failed workflow run failed, with its location', () => {
    expect(troubleshootPrompt(node({ resourceName: 'api-build-7', statusPhase: 'Failed' }))).toBe(
      'Why did workflow run `api-build-7` (component `api`, project `shop`, namespace `default`) fail? ' +
        'Read its status, events and logs with the OpenChoreo tools, explain the cause, and suggest a fix.',
    );
  });

  it('covers deployments and nothing else', () => {
    expect(troubleshootPrompt(node({ type: 'release-binding', resourceName: 'api-dev' }))).toMatch(
      /^Check the deployment `api-dev` \(component `api`/,
    );
    expect(troubleshootPrompt(node({ type: 'component' }))).toBeUndefined();
  });
});

describe('fixPrompt', () => {
  it('lists each problem with its 1-based line', () => {
    const uri = { scheme: 'file', fsPath: '/w/workload.yaml', path: '/w/workload.yaml' } as vscode.Uri;
    const diagnostic = { range: { start: { line: 11 } }, message: 'Unknown field "enviroment"' } as vscode.Diagnostic;
    expect(fixPrompt(uri, [diagnostic])).toMatch(
      /^Fix the OpenChoreo problems in workload\.yaml \(line 12: Unknown field "enviroment"\)\./,
    );
  });
});

describe('logSummaryPrompt', () => {
  it('keeps the most recent lines and says how many were left out', () => {
    const lines = Array.from({ length: 450 }, (_, i) => `line ${i}`);
    const prompt = logSummaryPrompt('component api in environment dev', lines);
    expect(prompt).toMatch(/^These are runtime logs of component api in environment dev \(the last 400 of 450 lines\)\./);
    expect(prompt).not.toContain('line 49\n');
    expect(prompt.endsWith('line 449')).toBe(true);
  });
});

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { workflowRunPhase } from '../treeView/runPhase';

const condition = (type: string, status: string, reason = type) => ({ type, status, reason });

describe('workflowRunPhase', () => {
  it('uses status.phase when the control plane sets it', () => {
    expect(workflowRunPhase({ phase: 'Running', conditions: [condition('WorkflowFailed', 'True')] })).toBe('Running');
  });

  it('reads 1.4 conditions', () => {
    expect(workflowRunPhase({ conditions: [
      condition('WorkflowCompleted', 'True', 'WorkflowFailed'),
      condition('WorkflowRunning', 'False', 'WorkflowRunning'),
      condition('WorkflowFailed', 'True'),
    ] })).toBe('Failed');
    expect(workflowRunPhase({ conditions: [
      condition('WorkflowCompleted', 'True', 'WorkflowSucceeded'),
      condition('WorkflowSucceeded', 'True'),
    ] })).toBe('Succeeded');
    expect(workflowRunPhase({ conditions: [condition('WorkflowRunning', 'True')] })).toBe('Running');
    expect(workflowRunPhase({ conditions: [condition('WorkflowCompleted', 'True', 'WorkflowFailed')] })).toBe('Failed');
    expect(workflowRunPhase({ conditions: [condition('WorkflowRunning', 'False', 'Pending')] })).toBe('Pending');
  });

  it('is undefined without status', () => {
    expect(workflowRunPhase(undefined)).toBeUndefined();
    expect(workflowRunPhase({})).toBeUndefined();
  });
});

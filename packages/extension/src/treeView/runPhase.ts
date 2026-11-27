// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

interface RunCondition {
  type?: string;
  status?: string;
  reason?: string;
}

/**
 * A WorkflowRun's phase from its listed status. Control planes before 1.4 set
 * `status.phase`; 1.4 reports only conditions (WorkflowRunning,
 * WorkflowSucceeded, WorkflowFailed, WorkflowCompleted).
 */
export function workflowRunPhase(status?: { phase?: string; conditions?: RunCondition[] }): string | undefined {
  if (status?.phase) return status.phase;
  const conditions = status?.conditions ?? [];
  const isTrue = (type: string) => conditions.some((c) => c.type === type && c.status === 'True');
  if (isTrue('WorkflowFailed')) return 'Failed';
  if (isTrue('WorkflowSucceeded')) return 'Succeeded';
  if (isTrue('WorkflowRunning')) return 'Running';
  const completed = conditions.find((c) => c.type === 'WorkflowCompleted' && c.status === 'True');
  if (completed) return completed.reason === 'WorkflowFailed' ? 'Failed' : 'Succeeded';
  return conditions.length > 0 ? 'Pending' : undefined;
}

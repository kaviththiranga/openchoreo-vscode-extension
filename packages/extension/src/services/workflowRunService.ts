// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { ApiClientManager } from '../api/apiClient';

/** Seconds since the epoch and nanoseconds of an RFC 3339 timestamp, or undefined. */
function timeKey(timestamp: string | undefined): [number, number] | undefined {
  const m = timestamp && /^(.+T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/i.exec(timestamp);
  if (!m) return undefined;
  const seconds = Date.parse(`${m[1]}${m[3]}`);
  return Number.isNaN(seconds) ? undefined : [seconds, Number((m[2] ?? '').padEnd(9, '0').slice(0, 9))];
}

/**
 * Log entries in time order. OpenChoreo 1.4 returns a run's logs grouped by
 * step, so a growing log isn't append-only until it is sorted. Entries are
 * left as they are when any lacks a timestamp.
 */
export function sortByTimestamp<T extends { timestamp?: string }>(entries: T[]): T[] {
  const keyed = entries.map((entry) => ({ entry, key: timeKey(entry.timestamp) }));
  if (keyed.some((k) => !k.key)) return entries;
  return keyed
    .sort((a, b) => a.key![0] - b.key![0] || a.key![1] - b.key![1])
    .map((k) => k.entry);
}

/**
 * A name for a new run of `base` (a component or workflow): a short suffix
 * from the current time in base 36, so later runs sort after earlier ones.
 */
export function newRunName(base: string, now = Date.now()): string {
  return `${base}-${now.toString(36)}`;
}

export class WorkflowRunService {
  constructor(private readonly apiClientManager: ApiClientManager) {}

  async getStatus(
    ns: string,
    runName: string,
  ): Promise<{
    status: string;
    steps: Array<{
      name: string;
      phase: string;
      startedAt?: string;
      finishedAt?: string;
    }>;
    hasLiveObservability: boolean;
  } | null> {
    const client = await this.apiClientManager.getClient();
    if (!client) return null;

    const { data, error } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/workflowruns/{runName}/status',
      { params: { path: { namespaceName: ns, runName } } },
    );

    if (error) throw new Error('Failed to fetch workflow run status');
    return data as {
      status: string;
      steps: Array<{ name: string; phase: string; startedAt?: string; finishedAt?: string }>;
      hasLiveObservability: boolean;
    };
  }

  async getLogs(
    ns: string,
    runName: string,
    task?: string,
  ): Promise<Array<{ timestamp?: string; log: string }>> {
    const client = await this.apiClientManager.getClient();
    if (!client) return [];

    const { data, error } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/workflowruns/{runName}/logs',
      { params: { path: { namespaceName: ns, runName }, query: { task } } },
    );

    if (error) throw new Error('Failed to fetch workflow run logs');
    return sortByTimestamp((data ?? []) as Array<{ timestamp?: string; log: string }>);
  }

  async getEvents(
    ns: string,
    runName: string,
    task?: string,
  ): Promise<
    Array<{ timestamp: string; type: string; reason: string; message: string }>
  > {
    const client = await this.apiClientManager.getClient();
    if (!client) return [];

    const { data, error } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/workflowruns/{runName}/events',
      { params: { path: { namespaceName: ns, runName }, query: { task } } },
    );

    if (error) throw new Error('Failed to fetch workflow run events');
    return (data ?? []) as Array<{
      timestamp: string;
      type: string;
      reason: string;
      message: string;
    }>;
  }

  async createWorkflowRun(
    ns: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const client = await this.apiClientManager.getClient();
    if (!client) return null;

    const { data, error } = await client.POST(
      '/api/v1/namespaces/{namespaceName}/workflowruns',
      {
        params: { path: { namespaceName: ns } },
        body: body as never,
      },
    );

    if (error) throw new Error('Failed to create workflow run');
    return data as Record<string, unknown>;
  }
}

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { ApiClientManager } from '../api/apiClient';

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
    return (data ?? []) as Array<{ timestamp?: string; log: string }>;
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

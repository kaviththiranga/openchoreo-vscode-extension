// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { ApiClientManager } from '../api/apiClient';

export interface ResourceNode {
  group?: string;
  version: string;
  kind: string;
  namespace?: string;
  name: string;
  uid: string;
  parentRefs?: Array<{ uid: string }>;
  object: Record<string, unknown>;
  health?: { status: string; message?: string };
}

export interface ReleaseResourceTree {
  name: string;
  targetPlane: 'dataplane' | 'observabilityplane';
  nodes: ResourceNode[];
}

export class ReleaseBindingService {
  constructor(private readonly apiClientManager: ApiClientManager) {}

  async getK8sResourceTree(
    ns: string,
    rbName: string,
  ): Promise<{ renderedReleases: ReleaseResourceTree[] } | null> {
    const client = await this.apiClientManager.getClient();
    if (!client) return null;

    const { data, error } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/releasebindings/{releaseBindingName}/k8sresources/tree',
      {
        params: {
          path: { namespaceName: ns, releaseBindingName: rbName },
        },
      },
    );

    if (error) throw new Error('Failed to fetch K8s resource tree');
    return data as { renderedReleases: ReleaseResourceTree[] };
  }

  async getK8sResourceEvents(
    ns: string,
    rbName: string,
    query: { group?: string; version: string; kind: string; name: string },
  ): Promise<
    Array<{
      type: string;
      reason: string;
      message: string;
      count?: number;
      firstTimestamp?: string;
      lastTimestamp?: string;
      source?: string;
    }>
  > {
    const client = await this.apiClientManager.getClient();
    if (!client) return [];

    const { data, error } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/releasebindings/{releaseBindingName}/k8sresources/events',
      {
        params: {
          path: { namespaceName: ns, releaseBindingName: rbName },
          query,
        },
      },
    );

    if (error) throw new Error('Failed to fetch K8s resource events');
    const resp = data as { events?: Array<{
      type: string;
      reason: string;
      message: string;
      count?: number;
      firstTimestamp?: string;
      lastTimestamp?: string;
      source?: string;
    }> };
    return resp?.events ?? [];
  }

  async getK8sResourceLogs(
    ns: string,
    rbName: string,
    podName: string,
    sinceSeconds?: number,
  ): Promise<Array<{ timestamp?: string; log: string }>> {
    const client = await this.apiClientManager.getClient();
    if (!client) return [];

    const { data, error } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/releasebindings/{releaseBindingName}/k8sresources/logs',
      {
        params: {
          path: { namespaceName: ns, releaseBindingName: rbName },
          query: { podName, sinceSeconds },
        },
      },
    );

    if (error) throw new Error('Failed to fetch pod logs');
    const resp = data as { logEntries?: Array<{ timestamp?: string; log: string }> };
    return resp?.logEntries ?? [];
  }
}

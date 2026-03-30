// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { ApiClientManager } from '../api/apiClient';

export class ComponentService {
  constructor(private readonly apiClientManager: ApiClientManager) {}

  async generateRelease(
    ns: string,
    componentName: string,
    releaseName?: string,
  ): Promise<{ metadata?: { name?: string } } | null> {
    const client = await this.apiClientManager.getClient();
    if (!client) return null;

    const { data, error } = await client.POST(
      '/api/v1/namespaces/{namespaceName}/components/{componentName}/generate-release',
      {
        params: { path: { namespaceName: ns, componentName } },
        body: { releaseName },
      },
    );

    if (error) {
      throw new Error('Failed to generate release');
    }

    return data as { metadata?: { name?: string } };
  }
}

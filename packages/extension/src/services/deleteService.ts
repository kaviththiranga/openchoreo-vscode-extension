// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { ApiClientManager } from '../api/apiClient';
import type { ResourceNodeData } from '../treeView/types';
import { ResourceService } from './resourceService';

export class DeleteService {
  private readonly resourceService = new ResourceService();

  constructor(private readonly apiClientManager: ApiClientManager) {}

  async deleteResource(node: ResourceNodeData): Promise<void> {
    const client = await this.apiClientManager.getClient();
    if (!client) {
      throw new Error('Not authenticated. Run "occ login" first.');
    }

    const kind = this.resourceService.getCrdKind(node.type);
    if (!kind) {
      throw new Error(`Delete not supported for resource type: ${node.type}`);
    }

    const name = node.resourceName ?? node.label;
    await this.resourceService.deleteResource(
      client,
      node.type,
      node.namespace,
      name,
    );
  }
}

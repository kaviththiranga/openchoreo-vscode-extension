// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { OccConfigAuthProvider } from '../auth/authProvider';
import type { ApiClientManager } from '../api/apiClient';
import type { ResourceNodeType } from '../treeView/types';

/**
 * Maps deletable node types to their candidate authz action name.
 * Action names are matched against the discovered actions from GET /api/v1/authz/actions.
 */
const DELETE_ACTION_MAP: Partial<Record<ResourceNodeType, string>> = {
  project: 'project:delete',
  component: 'component:delete',
  'component-type': 'componenttype:delete',
  workflow: 'workflow:delete',
  'component-workflow': 'componentworkflow:delete',
  trait: 'trait:delete',
  'cluster-role': 'role:delete',
  'namespace-role': 'role:delete',
  'cluster-role-binding': 'rolemapping:delete',
  'namespace-role-binding': 'rolemapping:delete',
};

interface ActionCapability {
  allowed?: Array<{ path: string; constraints?: Record<string, never> }>;
  denied?: Array<{ path: string; constraints?: Record<string, never> }>;
}

/**
 * Fetches and caches the user's RBAC capabilities.
 * Used to determine which context menu items (e.g. Delete) appear in tree views.
 */
export class CapabilityService {
  private availableActions: Set<string> | undefined;
  private capabilities: Record<string, ActionCapability> | undefined;
  private loaded = false;

  constructor(
    private readonly authProvider: OccConfigAuthProvider,
    private readonly apiClientManager: ApiClientManager,
  ) {
    authProvider.onDidChangeSession(() => this.invalidate());
  }

  /**
   * Fetch available actions and user capabilities from the API.
   * Called on connect/refresh. Results are cached until invalidated.
   */
  async refresh(namespace?: string): Promise<void> {
    try {
      const client = await this.apiClientManager.getClient();
      if (!client) {
        this.invalidate();
        return;
      }

      // Fetch available actions (may fail if authz is disabled -- that's OK)
      const { data: actionsData } = await client.GET('/api/v1/authz/actions');
      if (actionsData) {
        this.availableActions = new Set(actionsData as string[]);
      } else {
        // Authz disabled or actions unavailable -- skip action-name validation
        this.availableActions = undefined;
      }

      // Fetch user capabilities profile
      const { data: profileData, error: profileError } = await client.GET(
        '/api/v1/authz/profile',
        {
          params: {
            query: namespace ? { namespace } : undefined,
          },
        },
      );
      if (profileError || !profileData) {
        this.capabilities = undefined;
        // Mark as loaded even on failure so we don't retry every tree render
        this.loaded = true;
        return;
      }

      this.capabilities =
        (profileData as { capabilities?: Record<string, ActionCapability> })
          .capabilities ?? undefined;
      this.loaded = true;
    } catch {
      // Mark as loaded so we don't retry endlessly on persistent errors
      this.loaded = true;
    }
  }

  /**
   * Ensure capabilities are loaded. Only fetches if cache is empty.
   * Tree providers call this before building nodes to avoid race conditions.
   */
  async ensureLoaded(namespace?: string): Promise<void> {
    if (this.loaded) {
      return;
    }
    await this.refresh(namespace);
  }

  /** Clear cached capabilities. Next ensureLoaded() will re-fetch. */
  invalidate(): void {
    this.availableActions = undefined;
    this.capabilities = undefined;
    this.loaded = false;
  }

  /**
   * Check if the current user can delete a resource of the given type.
   * Synchronous -- uses cached data from the last refresh().
   *
   * Returns true only if:
   * 1. The node type has a known delete action mapping
   * 2. That action exists in the discovered actions list
   * 3. The user's capability profile allows it (has non-empty `allowed` list)
   */
  canDelete(nodeType: ResourceNodeType): boolean {
    if (!this.capabilities) {
      return false;
    }

    // Wildcard capability -- user can do everything
    const wildcard = this.capabilities['*'];
    if (wildcard?.allowed?.some((r) => r.path === '*')) {
      return nodeType in DELETE_ACTION_MAP;
    }

    const actionName = DELETE_ACTION_MAP[nodeType];
    if (!actionName) {
      return false;
    }

    // If actions list is available, verify the action exists
    if (this.availableActions && !this.availableActions.has(actionName)) {
      return false;
    }

    const capability = this.capabilities[actionName];
    if (!capability?.allowed || capability.allowed.length === 0) {
      return false;
    }

    return true;
  }
}

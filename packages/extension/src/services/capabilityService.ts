// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { OccConfigAuthProvider } from '../auth/authProvider';
import type { ApiClientManager } from '../api/apiClient';
import type { ResourceNodeType } from '../treeView/types';

/**
 * Maps deletable node types to their candidate authz action name.
 * Action names are matched against the discovered actions from GET /api/v1/authz/actions.
 */
/**
 * Maps deletable node types to their candidate authz action name.
 * Action names are matched against the discovered actions from GET /api/v1/authz/actions.
 */
const DELETE_ACTION_MAP: Partial<Record<ResourceNodeType, string>> = {
  project: 'project:delete',
  component: 'component:delete',
  'component-type': 'componenttype:delete',
  workflow: 'workflow:delete',
  trait: 'trait:delete',
  'namespace-role': 'authzrole:delete',
  'namespace-role-binding': 'authzrolebinding:delete',
  'cluster-role': 'clusterauthzrole:delete',
  'cluster-role-binding': 'clusterauthzrolebinding:delete',
};

/**
 * All resource types that have DELETE API endpoints.
 * Types in DELETE_ACTION_MAP are RBAC-gated; types only here are always deletable
 * (the server will reject if unauthorized).
 */
const DELETABLE_TYPES: ReadonlySet<ResourceNodeType> = new Set([
  // RBAC-gated (also in DELETE_ACTION_MAP)
  'project', 'component', 'component-type', 'workflow', 'trait',
  'cluster-role', 'namespace-role', 'cluster-role-binding', 'namespace-role-binding',
  // Always deletable (server enforces permissions)
  'environment', 'data-plane', 'workflow-plane', 'observability-plane',
  'deployment-pipeline', 'workload', 'secret-reference', 'release-binding',
  'resource', 'resource-release', 'resource-release-binding',
  // Cluster-scoped
  'cluster-component-type', 'cluster-workflow', 'cluster-trait',
  'cluster-data-plane', 'cluster-workflow-plane', 'cluster-observability-plane',
]);

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
      if (actionsData && Array.isArray(actionsData)) {
        // Actions response is an array of { name, lowestScope } objects
        const actionNames = actionsData.map(
          (a: { name: string }) => a.name,
        );
        this.availableActions = new Set(actionNames);
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
    // Not a deletable resource type at all
    if (!DELETABLE_TYPES.has(nodeType)) {
      return false;
    }

    // If no RBAC action is mapped for this type, allow delete
    // (the server will enforce permissions on the actual DELETE request)
    const actionName = DELETE_ACTION_MAP[nodeType];
    if (!actionName) {
      return true;
    }

    // RBAC-gated type — check capabilities
    if (!this.capabilities) {
      return false;
    }

    // Wildcard capability — user can do everything
    const wildcard = this.capabilities['*'];
    if (wildcard?.allowed?.some((r) => r.path === '*')) {
      return true;
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

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import {
  createOpenChoreoApiClient,
  createOpenChoreoLegacyApiClient,
} from '@openchoreo/openchoreo-client-node';
import type { OccConfigAuthProvider } from '../auth/authProvider';

type OpenChoreoClient = ReturnType<typeof createOpenChoreoApiClient>;
type OpenChoreoLegacyClient = ReturnType<typeof createOpenChoreoLegacyApiClient>;

/**
 * Manages typed OpenChoreo API client lifecycle (both new and legacy).
 *
 * Recreates clients whenever the token or base URL changes
 * (e.g. token refresh, context switch) and invalidates on session changes.
 */
export class ApiClientManager {
  private client: OpenChoreoClient | undefined;
  private legacyClient: OpenChoreoLegacyClient | undefined;
  private clientBaseUrl: string | undefined;
  private clientToken: string | undefined;

  constructor(private readonly authProvider: OccConfigAuthProvider) {
    authProvider.onDidChangeSession(() => this.invalidate());
  }

  /** Returns the new OpenChoreo API client (paths include /api/v1/). */
  async getClient(): Promise<OpenChoreoClient | undefined> {
    return (await this.ensureClients())?.client;
  }

  /** Returns the legacy OpenChoreo API client (for namespaces, workflows, definitions). */
  async getLegacyClient(): Promise<OpenChoreoLegacyClient | undefined> {
    return (await this.ensureClients())?.legacyClient;
  }

  private async ensureClients(): Promise<
    | { client: OpenChoreoClient; legacyClient: OpenChoreoLegacyClient }
    | undefined
  > {
    const session = this.authProvider.getSession();
    if (!session) {
      return undefined;
    }

    const token = await this.authProvider.getToken();
    if (!token) {
      return undefined;
    }

    const baseUrl = session.controlPlaneUrl;

    if (
      this.client &&
      this.legacyClient &&
      this.clientBaseUrl === baseUrl &&
      this.clientToken === token
    ) {
      return { client: this.client, legacyClient: this.legacyClient };
    }

    // New API: baseUrl is the host — paths already include /api/v1/
    this.client = createOpenChoreoApiClient({ baseUrl, token });
    // Legacy API: baseUrl includes /api/v1 — paths don't include it
    this.legacyClient = createOpenChoreoLegacyApiClient({
      baseUrl: `${baseUrl}/api/v1`,
      token,
    });
    this.clientBaseUrl = baseUrl;
    this.clientToken = token;
    return { client: this.client, legacyClient: this.legacyClient };
  }

  invalidate(): void {
    this.client = undefined;
    this.legacyClient = undefined;
    this.clientBaseUrl = undefined;
    this.clientToken = undefined;
  }
}

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { createOpenChoreoApiClient } from '@openchoreo/openchoreo-client-node';
import type { OccConfigAuthProvider } from '../auth/authProvider';
import { log } from '../logging/logger';

type OpenChoreoClient = ReturnType<typeof createOpenChoreoApiClient>;

/**
 * Manages typed OpenChoreo API client lifecycle.
 *
 * Recreates client whenever the token or base URL changes
 * (e.g. token refresh, context switch) and invalidates on session changes.
 */
export class ApiClientManager {
  private client: OpenChoreoClient | undefined;
  private clientBaseUrl: string | undefined;
  private clientToken: string | undefined;

  constructor(private readonly authProvider: OccConfigAuthProvider) {
    authProvider.onDidChangeSession(() => this.invalidate());
  }

  /** Returns the OpenChoreo API client. */
  async getClient(): Promise<OpenChoreoClient | undefined> {
    const session = this.authProvider.getSession();
    if (!session) {
      return undefined;
    }

    let token: string | undefined;
    if (session.securityEnabled) {
      const fetched = await this.authProvider.getToken();
      if (!fetched) {
        return undefined;
      }
      token = fetched;
    }
    // When security is disabled, `token` stays undefined and
    // createOpenChoreoApiClient omits the Authorization header entirely
    // (see factory.ts in @openchoreo/openchoreo-client-node).

    const baseUrl = session.controlPlaneUrl;
    const cacheKey = token ?? '';

    if (
      this.client &&
      this.clientBaseUrl === baseUrl &&
      this.clientToken === cacheKey
    ) {
      return this.client;
    }

    log.debug(
      `Creating API client for ${baseUrl} (auth: ${session.securityEnabled ? 'bearer' : 'disabled'})`,
    );
    this.client = createOpenChoreoApiClient({ baseUrl, token });
    this.clientBaseUrl = baseUrl;
    this.clientToken = cacheKey;
    return this.client;
  }

  invalidate(): void {
    this.client = undefined;
    this.clientBaseUrl = undefined;
    this.clientToken = undefined;
  }
}

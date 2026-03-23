// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { createOpenChoreoApiClient } from '@openchoreo/openchoreo-client-node';
import type { OccConfigAuthProvider } from '../auth/authProvider';

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

    const token = await this.authProvider.getToken();
    if (!token) {
      return undefined;
    }

    const baseUrl = session.controlPlaneUrl;

    if (
      this.client &&
      this.clientBaseUrl === baseUrl &&
      this.clientToken === token
    ) {
      return this.client;
    }

    this.client = createOpenChoreoApiClient({ baseUrl, token });
    this.clientBaseUrl = baseUrl;
    this.clientToken = token;
    return this.client;
  }

  invalidate(): void {
    this.client = undefined;
    this.clientBaseUrl = undefined;
    this.clientToken = undefined;
  }
}

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import type { OccConfigAuthProvider } from '../auth/authProvider';
import type { ApiClientManager } from '../api/apiClient';
import { isAtLeast, parseServerVersion, type ServerVersion } from '../api/serverVersion';
import { log } from '../logging/logger';

/**
 * Tracks the version of the connected control plane (GET /version) so
 * features and generated YAML can follow what the server supports.
 *
 * Fetched once per control-plane URL; re-fetched when the session points at
 * a different control plane.
 */
export class ServerInfoService implements vscode.Disposable {
  private version: ServerVersion | undefined;
  private versionUrl: string | undefined;
  private inFlight: Promise<void> | undefined;
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onDidChangeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly authProvider: OccConfigAuthProvider,
    private readonly apiClientManager: ApiClientManager,
  ) {
    this.disposables.push(authProvider.onDidChangeSession(() => void this.refresh()));
  }

  /** Last known server version, or undefined when not connected / not fetched yet. */
  getVersion(): ServerVersion | undefined {
    return this.version;
  }

  /**
   * True when the connected server is at least `major.minor` (see isAtLeast).
   * `fallback` answers while the version is unknown.
   */
  supports(major: number, minor: number, fallback = false): boolean {
    return isAtLeast(this.version, major, minor, fallback);
  }

  async refresh(): Promise<void> {
    const url = this.authProvider.getSession()?.controlPlaneUrl;
    if (!url) {
      this.set(undefined, undefined);
      return;
    }
    if (url === this.versionUrl && this.version) return;
    if (this.inFlight) return this.inFlight;

    this.inFlight = (async () => {
      try {
        const client = await this.apiClientManager.getClient();
        if (!client) return;
        const { data, error } = await client.GET('/version');
        if (error || !data) {
          log.debug(`GET /version failed for ${url}: ${JSON.stringify(error)}`);
          return;
        }
        const parsed = parseServerVersion((data as { version?: string }).version);
        log.debug(`Connected control plane ${url} reports version ${parsed?.raw ?? 'unknown'}`);
        this.set(parsed, url);
      } catch (err) {
        log.debug(`GET /version threw for ${url}: ${String(err)}`);
      } finally {
        this.inFlight = undefined;
      }
    })();
    return this.inFlight;
  }

  private set(version: ServerVersion | undefined, url: string | undefined): void {
    const changed = version?.raw !== this.version?.raw || url !== this.versionUrl;
    this.version = version;
    this.versionUrl = url;
    if (changed) this.onDidChangeEmitter.fire();
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

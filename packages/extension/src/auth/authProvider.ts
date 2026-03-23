// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parse as parseYaml } from 'yaml';
import { log } from '../logging/logger';

/**
 * Config types matching the occ CLI config format at ~/.openchoreo/config
 * See: openchoreo/internal/occ/cmd/config/types.go
 */
export interface OccConfig {
  currentContext: string;
  controlplanes: ControlPlane[];
  credentials: Credential[];
  contexts: OccContext[];
}

export interface ControlPlane {
  name: string;
  url: string;
}

export interface Credential {
  name: string;
  clientId: string;
  token: string;
  refreshToken: string;
  clientSecret: string;
  authMethod: string; // "pkce" | "client_credentials"
}

export interface OccContext {
  name: string;
  controlplane: string;
  credentials: string;
  namespace: string;
  project: string;
  component: string;
}

export interface AuthSession {
  token: string;
  refreshToken: string;
  clientId: string;
  authMethod: string;
  controlPlaneUrl: string;
  context: OccContext;
}

/** RFC 9728 OAuth Protected Resource Metadata */
interface OAuthProtectedResourceMetadata {
  authorization_servers: string[];
  openchoreo_clients: Array<{
    name: string;
    client_id: string;
    scopes: string[];
  }>;
  openchoreo_security_enabled: boolean;
}

/** RFC 8414 OpenID Connect Discovery */
interface OidcDiscovery {
  token_endpoint: string;
  authorization_endpoint: string;
}

const CONFIG_DIR = path.join(os.homedir(), '.openchoreo');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config');

export class OccConfigAuthProvider implements vscode.Disposable {
  private config: OccConfig | undefined;
  private fileWatcher: vscode.FileSystemWatcher | undefined;
  private onDidChangeSessionEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeSession = this.onDidChangeSessionEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.loadConfig();
  }

  /**
   * Start watching the occ config file for changes.
   * When occ CLI modifies the config (e.g., after login), the extension auto-updates.
   */
  startWatching(): void {
    // Use a simple polling-based approach since vscode.workspace.createFileSystemWatcher
    // only watches workspace files, not arbitrary system files
    const configPath = this.getConfigPath();
    if (fs.existsSync(configPath)) {
      let lastMtime = fs.statSync(configPath).mtimeMs;

      const interval = setInterval(() => {
        try {
          const currentMtime = fs.statSync(configPath).mtimeMs;
          if (currentMtime !== lastMtime) {
            lastMtime = currentMtime;
            this.loadConfig();
            this.onDidChangeSessionEmitter.fire();
          }
        } catch {
          // Config file may not exist yet
        }
      }, 5000);

      this.context.subscriptions.push({
        dispose: () => clearInterval(interval),
      });
    }
  }

  /**
   * Load and parse the occ CLI config file.
   */
  loadConfig(): void {
    const configPath = this.getConfigPath();
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      this.config = parseYaml(content) as OccConfig;
    } catch {
      this.config = undefined;
    }
  }

  /**
   * Get the current authentication session from the occ CLI config.
   * Returns undefined if not logged in or config doesn't exist.
   */
  getSession(): AuthSession | undefined {
    if (!this.config) {
      return undefined;
    }

    const currentCtx = this.config.contexts.find(
      (c) => c.name === this.config!.currentContext,
    );
    if (!currentCtx) {
      return undefined;
    }

    const credential = this.config.credentials.find(
      (c) => c.name === currentCtx.credentials,
    );
    if (!credential || !credential.token) {
      return undefined;
    }

    const controlPlane = this.config.controlplanes.find(
      (c) => c.name === currentCtx.controlplane,
    );
    if (!controlPlane) {
      return undefined;
    }

    return {
      token: credential.token,
      refreshToken: credential.refreshToken,
      clientId: credential.clientId,
      authMethod: credential.authMethod,
      controlPlaneUrl: controlPlane.url,
      context: currentCtx,
    };
  }

  /**
   * Get a valid access token, refreshing if necessary.
   */
  async getToken(): Promise<string | undefined> {
    const session = this.getSession();
    if (!session) {
      return undefined;
    }

    // Check if token is expired
    if (this.isTokenExpired(session.token)) {
      log.info('Token expired, attempting refresh...');
      const refreshed = await this.refreshToken(session);
      if (refreshed) {
        log.info('Token refreshed successfully');
        return refreshed;
      }
      log.error('Token refresh failed');
      return undefined;
    }

    return session.token;
  }

  /**
   * Get the current context info for display.
   */
  getContextInfo(): {
    contextName: string;
    namespace: string;
    project: string;
    controlPlaneUrl: string;
  } | undefined {
    const session = this.getSession();
    if (!session) {
      return undefined;
    }

    return {
      contextName: session.context.name,
      namespace: session.context.namespace,
      project: session.context.project,
      controlPlaneUrl: session.controlPlaneUrl,
    };
  }

  /**
   * Get all available context names for context switching.
   */
  getAvailableContexts(): string[] {
    return this.config?.contexts.map((c) => c.name) ?? [];
  }

  /**
   * Update the namespace in the current occ CLI context.
   * Writes the change to disk and fires a session change event.
   */
  updateNamespace(namespace: string): void {
    if (!this.config) {
      return;
    }

    const currentCtx = this.config.contexts.find(
      (c) => c.name === this.config!.currentContext,
    );
    if (!currentCtx) {
      return;
    }

    currentCtx.namespace = namespace;

    // Write back to config file
    try {
      const configPath = this.getConfigPath();
      const { stringify } = require('yaml');
      fs.writeFileSync(configPath, stringify(this.config), {
        mode: 0o600,
      });
    } catch {
      // Non-fatal
    }

    this.onDidChangeSessionEmitter.fire();
  }

  /**
   * Check if a JWT token is expired (with 60s buffer).
   */
  private isTokenExpired(token: string): boolean {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return true;
      }
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8'),
      );
      const exp = payload.exp;
      if (!exp) {
        return true;
      }
      // Consider expired if within 60 seconds of expiration
      return Date.now() / 1000 >= exp - 60;
    } catch {
      return true;
    }
  }

  /**
   * Refresh the access token using the OIDC token endpoint.
   * Uses RFC 9728 two-step discovery:
   * 1. GET /.well-known/oauth-protected-resource → authorization server URL
   * 2. GET {authServer}/.well-known/openid-configuration → token endpoint
   */
  private async refreshToken(session: AuthSession): Promise<string | undefined> {
    if (!session.refreshToken) {
      return undefined;
    }

    try {
      // Step 1: Fetch OAuth protected resource metadata (RFC 9728)
      log.debug(`Fetching auth metadata from ${session.controlPlaneUrl}`);
      const metadata = await this.fetchAuthMetadata(session.controlPlaneUrl);
      if (!metadata || !metadata.openchoreo_security_enabled) {
        log.debug('Security disabled or metadata unavailable, using existing token');
        return session.token;
      }

      if (
        !metadata.authorization_servers ||
        metadata.authorization_servers.length === 0
      ) {
        return undefined;
      }

      // Step 2: Fetch OIDC discovery from the authorization server
      const authServer = metadata.authorization_servers[0];
      log.debug(`Fetching OIDC discovery from ${authServer}`);
      const oidcConfig = await this.fetchOidcDiscovery(authServer);
      if (!oidcConfig) {
        log.error('Failed to fetch OIDC discovery');
        return undefined;
      }

      // Exchange refresh token for new access token
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: session.refreshToken,
        client_id: session.clientId,
      });

      const response = await fetch(oidcConfig.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (!response.ok) {
        return undefined;
      }

      const data = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
      };

      // Update the config file with new tokens (same as occ CLI does)
      this.updateStoredTokens(
        session.context.credentials,
        data.access_token,
        data.refresh_token ?? session.refreshToken,
      );

      return data.access_token;
    } catch (err) {
      log.error('Token refresh failed', err);
      return undefined;
    }
  }

  /**
   * Fetch OAuth Protected Resource Metadata (RFC 9728).
   */
  private async fetchAuthMetadata(
    controlPlaneUrl: string,
  ): Promise<OAuthProtectedResourceMetadata | undefined> {
    try {
      const response = await fetch(
        `${controlPlaneUrl}/.well-known/oauth-protected-resource`,
      );
      if (!response.ok) {
        return undefined;
      }
      return (await response.json()) as OAuthProtectedResourceMetadata;
    } catch {
      return undefined;
    }
  }

  /**
   * Fetch OIDC Discovery document (RFC 8414) from the authorization server.
   */
  private async fetchOidcDiscovery(
    authServerUrl: string,
  ): Promise<OidcDiscovery | undefined> {
    try {
      const response = await fetch(
        `${authServerUrl}/.well-known/openid-configuration`,
      );
      if (!response.ok) {
        return undefined;
      }
      return (await response.json()) as OidcDiscovery;
    } catch {
      return undefined;
    }
  }

  /**
   * Update stored tokens in the config file after refresh.
   */
  private updateStoredTokens(
    credentialName: string,
    newToken: string,
    newRefreshToken: string,
  ): void {
    if (!this.config) {
      return;
    }

    const credential = this.config.credentials.find(
      (c) => c.name === credentialName,
    );
    if (credential) {
      credential.token = newToken;
      credential.refreshToken = newRefreshToken;
    }

    // Write back to config file
    try {
      const configPath = this.getConfigPath();
      const { stringify } = require('yaml');
      fs.writeFileSync(configPath, stringify(this.config), {
        mode: 0o600,
      });
    } catch {
      // Non-fatal: token is updated in memory even if file write fails
    }
  }

  private getConfigPath(): string {
    const customPath = vscode.workspace
      .getConfiguration('openchoreo')
      .get<string>('configPath');
    return customPath || CONFIG_FILE;
  }

  dispose(): void {
    this.fileWatcher?.dispose();
    this.onDidChangeSessionEmitter.dispose();
  }
}

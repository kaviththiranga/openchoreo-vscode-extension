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
  /** Bearer token. Empty string when the cluster has security disabled. */
  token: string;
  refreshToken: string;
  clientId: string;
  authMethod: string;
  controlPlaneUrl: string;
  context: OccContext;
  /**
   * True when the control plane requires authentication, false when the
   * helm chart disables security. Determines whether API calls need a
   * Bearer header and whether to skip the OIDC refresh path.
   */
  securityEnabled: boolean;
}

/**
 * Identity claims extracted from the decoded JWT access token.
 * OpenChoreo does not expose a /userinfo endpoint, so all fields come
 * directly from JWT payload claims set by the auth server.
 */
export interface UserIdentity {
  /** Preferred human-readable display name. */
  displayName?: string;
  email?: string;
  /** JWT `sub` claim — stable unique identifier. */
  subject?: string;
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

  /**
   * Cache of `openchoreo_security_enabled` per control-plane URL, populated
   * by `probeSecurityEnabled()`. Missing entry = "not probed yet"; we treat
   * that as "security enabled" (the safer default) until the probe answers.
   */
  private securityEnabledCache = new Map<string, boolean>();
  /** Tracks URLs with an in-flight probe so we don't fire duplicates. */
  private inflightProbes = new Set<string>();

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
   * Force an immediate config reload and fire the session change event.
   * Used right after `occ login` exits so the sidebar switches to the tree
   * view without waiting for the 5s file-watcher poll.
   */
  reload(): void {
    this.loadConfig();
    // A reload follows occ login/logout/context-switch; invalidate the
    // security-enabled cache so a flipped-config control plane is re-probed.
    this.securityEnabledCache.clear();
    this.inflightProbes.clear();
    this.onDidChangeSessionEmitter.fire();
  }

  /**
   * Resolve the security-enabled flag for the current context's control
   * plane before any consumer of getSession() needs it. Used at extension
   * activation so the first MCP `provideMcpServerDefinitions()` call has
   * a populated cache and returns the server immediately (otherwise the
   * first call returns [] while the async probe is in flight, and some
   * MCP hosts don't re-query on the subsequent change event).
   */
  async prewarm(): Promise<void> {
    if (!this.config) return;
    const ctx = this.config.contexts.find((c) => c.name === this.config!.currentContext);
    if (!ctx) return;
    const cp = this.config.controlplanes.find((c) => c.name === ctx.controlplane);
    if (!cp) return;
    const cred = this.config.credentials.find((c) => c.name === ctx.credentials);
    // Only probe when we'd actually depend on the result — i.e. tokenless contexts.
    if (cred && cred.token) return;
    await this.probeSecurityEnabled(cp.url);
  }

  /**
   * Get the current authentication session from the occ CLI config.
   *
   * Returns a session when either:
   *  - the credential has a token (normal auth-enabled flow), or
   *  - the control-plane URL has been probed and reported
   *    `openchoreo_security_enabled: false` (auth-disabled flow).
   *
   * For a tokenless credential where security state is unknown, kicks off
   * an async probe and returns undefined for now. The probe fires
   * onDidChangeSession when it completes so the sidebar re-renders.
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
    if (!credential) {
      return undefined;
    }

    const controlPlane = this.config.controlplanes.find(
      (c) => c.name === currentCtx.controlplane,
    );
    if (!controlPlane) {
      return undefined;
    }

    const baseSession = {
      refreshToken: credential.refreshToken,
      clientId: credential.clientId,
      authMethod: credential.authMethod,
      controlPlaneUrl: controlPlane.url,
      context: currentCtx,
    };

    if (credential.token) {
      // Normal auth-enabled session. Don't bother probing — having a token
      // already implies the server issued one, which means security is on.
      return {
        ...baseSession,
        token: credential.token,
        securityEnabled: true,
      };
    }

    // Tokenless credential: check the probe cache for this control-plane URL.
    const cached = this.securityEnabledCache.get(controlPlane.url);
    if (cached === false) {
      return { ...baseSession, token: '', securityEnabled: false };
    }
    if (cached === true) {
      // Server confirmed it needs auth but we have no token — not logged in.
      return undefined;
    }

    // Not probed yet — fire-and-forget; the next change event will surface it.
    void this.probeSecurityEnabled(controlPlane.url);
    return undefined;
  }

  /**
   * Probe the control-plane's OAuth metadata to learn whether it requires
   * authentication. Caches the result and fires onDidChangeSession so any
   * pending tokenless session is re-evaluated.
   */
  private async probeSecurityEnabled(controlPlaneUrl: string): Promise<void> {
    if (this.inflightProbes.has(controlPlaneUrl)) return;
    if (this.securityEnabledCache.has(controlPlaneUrl)) return;
    this.inflightProbes.add(controlPlaneUrl);
    try {
      const metadata = await this.fetchAuthMetadata(controlPlaneUrl);
      if (!metadata) {
        // Probe failed (network error or 404). Leave the cache empty so
        // we can retry later; treat the session as not connected for now.
        return;
      }
      this.securityEnabledCache.set(
        controlPlaneUrl,
        metadata.openchoreo_security_enabled,
      );
      this.onDidChangeSessionEmitter.fire();
    } finally {
      this.inflightProbes.delete(controlPlaneUrl);
    }
  }

  /**
   * Get a valid access token, refreshing if necessary.
   *
   * Returns `''` (empty string) when security is disabled — callers
   * should check `session.securityEnabled` first and skip the
   * Authorization header entirely in that case.
   */
  async getToken(): Promise<string | undefined> {
    const session = this.getSession();
    if (!session) {
      return undefined;
    }

    if (!session.securityEnabled) {
      return '';
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
   * Extract the signed-in user's identity from the JWT access token.
   *
   * OpenChoreo's auth server doesn't expose a /userinfo endpoint, so we
   * decode the access token payload directly — same pattern as the
   * Backstage OIDC authenticator at
   * `backstage-plugins/plugins/auth-backend-module-openchoreo-auth/src/oidcAuthenticator.ts`.
   *
   * Returns undefined if there's no session or the token isn't a valid JWT.
   */
  getUserIdentity(): UserIdentity | undefined {
    const session = this.getSession();
    if (!session?.token) return undefined;

    const payload = decodeJwtPayload(session.token);
    if (!payload) return undefined;

    // Display name fallback chain matches Backstage's extractProfileFromPayload:
    // name → given_name + family_name → email → preferred_username → username → sub
    const given = typeof payload.given_name === 'string' ? payload.given_name : undefined;
    const family = typeof payload.family_name === 'string' ? payload.family_name : undefined;
    const fullName = given && family ? `${given} ${family}` : given || family;

    const displayName =
      (typeof payload.name === 'string' && payload.name) ||
      fullName ||
      (typeof payload.email === 'string' && payload.email) ||
      (typeof payload.preferred_username === 'string' && payload.preferred_username) ||
      (typeof payload.username === 'string' && payload.username) ||
      (typeof payload.unique_name === 'string' && payload.unique_name) ||
      undefined;

    return {
      displayName: displayName || undefined,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      subject: typeof payload.sub === 'string' ? payload.sub : undefined,
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
  /**
   * Switch the current context in the occ CLI config.
   * Writes the change to disk and fires a session change event.
   */
  switchContext(contextName: string): void {
    if (!this.config) return;
    const exists = this.config.contexts.some((c) => c.name === contextName);
    if (!exists) return;

    this.config.currentContext = contextName;

    try {
      const configPath = this.getConfigPath();
      const { stringify } = require('yaml');
      fs.writeFileSync(configPath, stringify(this.config), { mode: 0o600 });
    } catch {
      // Non-fatal
    }

    this.onDidChangeSessionEmitter.fire();
  }

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
    const payload = decodeJwtPayload(token);
    if (!payload || typeof payload.exp !== 'number') return true;
    // Consider expired if within 60 seconds of expiration
    return Date.now() / 1000 >= payload.exp - 60;
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

/**
 * Decode a JWT payload without signature verification. Used for reading
 * expiration and identity claims from access tokens already trusted by
 * the occ CLI login flow.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return undefined;
    const json = Buffer.from(parts[1], 'base64url').toString('utf-8');
    const payload = JSON.parse(json);
    return typeof payload === 'object' && payload !== null ? payload : undefined;
  } catch {
    return undefined;
  }
}

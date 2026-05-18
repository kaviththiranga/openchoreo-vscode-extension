// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { vscode } from '../hooks/useVscodeApi';
import { LINKS } from '../constants/links';
import type { ConnectionStatus } from '../types/protocol';

interface NotConnectedViewProps {
  status: ConnectionStatus;
  cliVersion?: string;
  cliVersionDetails?: string;
  loginError?: string;
}

/**
 * Adaptive onboarding view rendered when there's no active OpenChoreo
 * session. Switches on `status` to guide the user through whichever step
 * they're stuck on: installing the CLI, logging in, waiting for the
 * browser callback, or recovering from a failed login.
 */
export function NotConnectedView({
  status,
  cliVersion,
  cliVersionDetails,
  loginError,
}: NotConnectedViewProps) {
  const openExternal = (url: string) => vscode.postMessage({ type: 'openExternal', url });

  return (
    <div class="sidebar">
      <div class="onboarding">
        {status === 'no-cli' && <NoCliPanel openExternal={openExternal} />}
        {status === 'no-session' && (
          <NoSessionPanel cliVersion={cliVersion} cliVersionDetails={cliVersionDetails} />
        )}
        {status === 'logging-in' && <LoggingInPanel />}
        {status === 'login-failed' && <LoginFailedPanel loginError={loginError} openExternal={openExternal} />}
        <OnboardingFooter openExternal={openExternal} />
      </div>
    </div>
  );
}

// ── Panels ────────────────────────────────────────────────────────────

function NoCliPanel({ openExternal }: { openExternal: (url: string) => void }) {
  return (
    <div class="onboarding-panel">
      <i class="codicon codicon-terminal onboarding-icon" />
      <h3 class="onboarding-title">OpenChoreo CLI not found</h3>
      <p class="onboarding-body">
        This extension uses the <code>occ</code> CLI to authenticate with your
        OpenChoreo control plane. Let the extension download it for you (~14 MB),
        or install it manually and come back here.
      </p>
      <button
        class="vscode-button vscode-button-primary"
        onClick={() => vscode.postMessage({ type: 'downloadCli' })}
      >
        <i class="codicon codicon-cloud-download" />
        <span>Download for me (~14 MB)</span>
      </button>
      <button
        class="vscode-button vscode-button-secondary"
        onClick={() => openExternal(LINKS.cliInstall)}
      >
        <i class="codicon codicon-link-external" />
        <span>Open install guide</span>
      </button>
      <button
        class="vscode-button vscode-button-secondary"
        onClick={() => vscode.postMessage({ type: 'recheckCli' })}
      >
        I've installed it
      </button>
    </div>
  );
}

function NoSessionPanel({
  cliVersion,
  cliVersionDetails,
}: {
  cliVersion?: string;
  cliVersionDetails?: string;
}) {
  return (
    <div class="onboarding-panel">
      <i class="codicon codicon-key onboarding-icon" />
      <h3 class="onboarding-title">Not logged in</h3>
      <p class="onboarding-body">
        Log in to your OpenChoreo control plane to browse projects,
        components, and cluster resources.
      </p>
      <button
        class="vscode-button vscode-button-primary"
        onClick={() => vscode.postMessage({ type: 'startLogin' })}
      >
        <i class="codicon codicon-sign-in" />
        <span>Login with OpenChoreo CLI</span>
      </button>
      {cliVersion && (
        <p class="onboarding-footnote">
          <span>Using {cliVersion}</span>
          {cliVersionDetails && (
            <span
              class="onboarding-info-icon"
              aria-label={cliVersionDetails}
              data-tooltip={cliVersionDetails}
            >
              <i class="codicon codicon-info" />
            </span>
          )}
        </p>
      )}
    </div>
  );
}

function LoggingInPanel() {
  return (
    <div class="onboarding-panel">
      <i class="codicon codicon-globe onboarding-icon onboarding-icon-spinning" />
      <h3 class="onboarding-title">Waiting for browser…</h3>
      <p class="onboarding-body">
        Complete the login in your browser. If a browser window didn't open,
        check the output channel for a fallback URL.
      </p>
      <div class="progress-bar">
        <div class="progress-bar-indicator" />
      </div>
      <button
        class="vscode-button vscode-button-secondary"
        onClick={() => vscode.postMessage({ type: 'cancelLogin' })}
      >
        Cancel
      </button>
      <button
        class="onboarding-link-button"
        onClick={() => vscode.postMessage({ type: 'executeCommand', command: 'openchoreo.showLoginOutput' })}
      >
        Open output
      </button>
    </div>
  );
}

function LoginFailedPanel({
  loginError,
  openExternal,
}: {
  loginError?: string;
  openExternal: (url: string) => void;
}) {
  return (
    <div class="onboarding-panel">
      <i class="codicon codicon-error onboarding-icon onboarding-icon-error" />
      <h3 class="onboarding-title">Login failed</h3>
      {loginError && (
        <pre class="onboarding-error">{loginError}</pre>
      )}
      <button
        class="vscode-button vscode-button-primary"
        onClick={() => vscode.postMessage({ type: 'startLogin' })}
      >
        Try again
      </button>
      <button
        class="onboarding-link-button"
        onClick={() => openExternal(LINKS.docs)}
      >
        Open docs
      </button>
    </div>
  );
}

// ── Footer ────────────────────────────────────────────────────────────

function OnboardingFooter({ openExternal }: { openExternal: (url: string) => void }) {
  return (
    <div class="onboarding-footer">
      <button class="onboarding-link-button" onClick={() => openExternal(LINKS.docs)}>
        Docs
      </button>
      <span class="onboarding-footer-sep">·</span>
      <button class="onboarding-link-button" onClick={() => openExternal(LINKS.github)}>
        GitHub
      </button>
      <span class="onboarding-footer-sep">·</span>
      <button class="onboarding-link-button" onClick={() => openExternal(LINKS.home)}>
        openchoreo.dev
      </button>
    </div>
  );
}

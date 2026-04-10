// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Canonical URLs shown in the sidebar's onboarding view. Centralized so
 * they stay consistent across the "no-cli", "no-session", and
 * "login-failed" states and the footer. All external navigation goes
 * through the `openExternal` webview message, which allowlists hostnames
 * on the extension host side.
 */
export const LINKS = {
  cliInstall: 'https://openchoreo.dev/docs/developer-guide/cli-installation/',
  docs: 'https://openchoreo.dev/docs',
  home: 'https://openchoreo.dev',
  github: 'https://github.com/openchoreo/openchoreo',
} as const;

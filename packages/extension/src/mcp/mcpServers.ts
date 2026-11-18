// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Which OpenChoreo MCP servers to offer the editor, and how to reach them.
 * Pure so it can be unit-tested outside the extension host.
 *
 * Labels match the names the upstream openchoreo/skills use (`openchoreo-cp`,
 * `openchoreo-obs`), so skills and custom agents can refer to them.
 */

/**
 * Control-plane toolsets for application developers. Unknown names are
 * ignored by the server, so `endpoint` (1.4+) is harmless on older servers.
 */
export const DEVELOPER_TOOLSETS = [
  'namespace',
  'project',
  'component',
  'resource',
  'deployment',
  'build',
  'endpoint',
];

/** The platform-engineer toolset, offered as a separate server. */
export const PLATFORM_ENGINEER_TOOLSETS = ['pe'];

export const SERVER_LABELS = {
  controlPlane: 'openchoreo-cp',
  platformEngineer: 'openchoreo-pe',
  observer: 'openchoreo-obs',
  sreAgent: 'openchoreo-sre',
} as const;

export interface McpServerSpec {
  label: string;
  url: string;
  headers: Record<string, string>;
}

export interface McpServerInputs {
  controlPlaneUrl: string;
  /** Bearer token; undefined when the control plane has security disabled. */
  token: string | undefined;
  /** Toolsets for `openchoreo-cp`; empty means every toolset the server enables. */
  toolsets: string[];
  platformEngineerTools: boolean;
  observerUrls: string[];
  sreAgentUrls: string[];
}

export function buildMcpServerSpecs(inputs: McpServerInputs): McpServerSpec[] {
  const headers: Record<string, string> = inputs.token
    ? { Authorization: `Bearer ${inputs.token}` }
    : {};
  const specs: McpServerSpec[] = [];
  const controlPlaneMcp = `${trimSlash(inputs.controlPlaneUrl)}/mcp`;

  specs.push({
    label: SERVER_LABELS.controlPlane,
    url: controlPlaneUrl(controlPlaneMcp, inputs.toolsets, !inputs.token),
    headers,
  });
  if (inputs.platformEngineerTools) {
    specs.push({
      label: SERVER_LABELS.platformEngineer,
      url: controlPlaneUrl(controlPlaneMcp, PLATFORM_ENGINEER_TOOLSETS, !inputs.token),
      headers,
    });
  }
  uniqueUrls(inputs.observerUrls).forEach((url, i) =>
    specs.push({ label: numbered(SERVER_LABELS.observer, i), url: `${url}/mcp`, headers }),
  );
  uniqueUrls(inputs.sreAgentUrls).forEach((url, i) =>
    specs.push({ label: numbered(SERVER_LABELS.sreAgent, i), url: `${url}/mcp`, headers }),
  );
  return specs;
}

function controlPlaneUrl(base: string, toolsets: string[], authDisabled: boolean): string {
  const params: string[] = [];
  const names = toolsets.map((t) => t.trim()).filter(Boolean);
  if (names.length > 0) params.push(`toolsets=${names.map(encodeURIComponent).join(',')}`);
  // On auth-disabled clusters there is no user to filter tools/list by, so the
  // default per-user filter would hide every tool. The API still enforces
  // its own authorization on each call.
  if (authDisabled) params.push('filterByAuthz=false');
  return params.length > 0 ? `${base}?${params.join('&')}` : base;
}

function uniqueUrls(urls: string[]): string[] {
  return [...new Set(urls.map(trimSlash).filter(Boolean))];
}

function numbered(label: string, index: number): string {
  return index === 0 ? label : `${label}-${index + 1}`;
}

function trimSlash(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

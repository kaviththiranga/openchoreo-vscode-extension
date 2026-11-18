// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { ObservabilityUrlResolver } from '@openchoreo/openchoreo-client-node';

export interface ObservabilityEndpoints {
  observerUrls: string[];
  sreAgentUrls: string[];
}

export interface DiscoveryOptions {
  namespace: string;
  token: string | undefined;
  listEnvironments: () => Promise<string[]>;
  resolver: Pick<ObservabilityUrlResolver, 'resolveForEnvironment' | 'resolveForPlatform'>;
  log?: (message: string) => void;
}

/** Environments resolved per discovery; namespaces rarely have more. */
const MAX_ENVIRONMENTS = 20;

/**
 * Finds the observer and SRE agent base URLs reachable from the current
 * namespace: each environment resolves through its data plane to an
 * observability plane. Developers often cannot read planes, so when that
 * yields no observer, fall back to the platform observer the API advertises
 * to any authenticated user (GET /api/v1alpha1/metadata).
 */
export async function discoverObservabilityEndpoints(
  opts: DiscoveryOptions,
): Promise<ObservabilityEndpoints> {
  const observerUrls: string[] = [];
  const sreAgentUrls: string[] = [];

  let environments: string[] = [];
  try {
    environments = (await opts.listEnvironments()).slice(0, MAX_ENVIRONMENTS);
  } catch (err) {
    opts.log?.(`MCP discovery: cannot list environments in ${opts.namespace}: ${String(err)}`);
  }

  const results = await Promise.allSettled(
    environments.map((env) => opts.resolver.resolveForEnvironment(opts.namespace, env, opts.token)),
  );
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      opts.log?.(`MCP discovery: environment ${environments[i]}: ${String(result.reason)}`);
      return;
    }
    if (result.value.observerUrl) observerUrls.push(result.value.observerUrl);
    if (result.value.rcaAgentUrl) sreAgentUrls.push(result.value.rcaAgentUrl);
  });

  if (observerUrls.length === 0) {
    try {
      const platform = await opts.resolver.resolveForPlatform(opts.token);
      if (platform.observerUrl) observerUrls.push(platform.observerUrl);
      if (platform.rcaAgentUrl) sreAgentUrls.push(platform.rcaAgentUrl);
    } catch (err) {
      opts.log?.(`MCP discovery: platform metadata: ${String(err)}`);
    }
  }

  return { observerUrls: unique(observerUrls), sreAgentUrls: unique(sreAgentUrls) };
}

function unique(urls: string[]): string[] {
  return [...new Set(urls.map((u) => u.replace(/\/+$/, '')))];
}

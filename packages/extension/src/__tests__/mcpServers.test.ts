// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { buildMcpServerSpecs, DEVELOPER_TOOLSETS } from '../mcp/mcpServers';
import { discoverObservabilityEndpoints } from '../mcp/mcpDiscovery';

const base = {
  controlPlaneUrl: 'http://api.example.com/',
  token: 'tok',
  toolsets: DEVELOPER_TOOLSETS,
  platformEngineerTools: false,
  observerUrls: [],
  sreAgentUrls: [],
};

describe('buildMcpServerSpecs', () => {
  it('offers the developer toolsets on openchoreo-cp with a bearer header', () => {
    const [cp, ...rest] = buildMcpServerSpecs(base);
    expect(rest).toEqual([]);
    expect(cp.label).toBe('openchoreo-cp');
    expect(cp.url).toBe(
      'http://api.example.com/mcp?toolsets=namespace,project,component,resource,deployment,build,endpoint',
    );
    expect(cp.headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('omits the toolsets filter when the list is empty', () => {
    expect(buildMcpServerSpecs({ ...base, toolsets: [' '] })[0].url).toBe('http://api.example.com/mcp');
  });

  it('skips authz filtering and the header on auth-disabled clusters', () => {
    const specs = buildMcpServerSpecs({ ...base, token: undefined, platformEngineerTools: true });
    expect(specs.map((s) => s.url)).toEqual([
      'http://api.example.com/mcp?toolsets=namespace,project,component,resource,deployment,build,endpoint&filterByAuthz=false',
      'http://api.example.com/mcp?toolsets=pe&filterByAuthz=false',
    ]);
    expect(specs.every((s) => Object.keys(s.headers).length === 0)).toBe(true);
  });

  it('adds observer and SRE agent servers, deduplicated and numbered', () => {
    const specs = buildMcpServerSpecs({
      ...base,
      observerUrls: ['http://obs.a/', 'http://obs.a', 'http://obs.b'],
      sreAgentUrls: ['http://rca.a'],
    });
    expect(specs.slice(1).map((s) => [s.label, s.url])).toEqual([
      ['openchoreo-obs', 'http://obs.a/mcp'],
      ['openchoreo-obs-2', 'http://obs.b/mcp'],
      ['openchoreo-sre', 'http://rca.a/mcp'],
    ]);
  });
});

describe('discoverObservabilityEndpoints', () => {
  it('collects URLs per environment and skips environments that fail', async () => {
    const found = await discoverObservabilityEndpoints({
      namespace: 'default',
      token: 'tok',
      listEnvironments: async () => ['dev', 'staging', 'prod'],
      resolver: {
        resolveForEnvironment: async (_ns, env) => {
          if (env === 'prod') throw new Error('403');
          return { observerUrl: 'http://obs/', rcaAgentUrl: env === 'dev' ? 'http://rca' : undefined };
        },
        resolveForPlatform: async () => {
          throw new Error('not expected');
        },
      },
    });
    expect(found).toEqual({ observerUrls: ['http://obs'], sreAgentUrls: ['http://rca'] });
  });

  it('falls back to the platform observer when planes are unreadable', async () => {
    const found = await discoverObservabilityEndpoints({
      namespace: 'default',
      token: 'tok',
      listEnvironments: async () => {
        throw new Error('403');
      },
      resolver: {
        resolveForEnvironment: async () => ({}),
        resolveForPlatform: async () => ({ observerUrl: 'http://platform-obs' }),
      },
    });
    expect(found).toEqual({ observerUrls: ['http://platform-obs'], sreAgentUrls: [] });
  });
});

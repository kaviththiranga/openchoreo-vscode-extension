// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import { pushResourceNames, pushResourceSchemas } from '../services/languageServerFeed';
import type { ApiClientManager } from '../api/apiClient';
import type { OccConfigAuthProvider } from '../auth/authProvider';
import type { ManagedLanguageClient } from '../services/occLanguageServer';

function fixture() {
  const api = { GET: vi.fn(async (path: string) => {
    if (path === '/api/v1/namespaces') return { data: { items: [{ metadata: { name: 'default' } }] } };
    if (path.endsWith('/componentreleases')) return { data: { items: [{ metadata: { name: 'r1' }, spec: { owner: { componentName: 'app' } } }] } };
    return { data: { items: [{ metadata: { name: 'service' }, spec: {
      parameters: { openAPIV3Schema: { type: 'object', properties: { greeting: { type: 'string' } } } },
      environmentConfigs: { openAPIV3Schema: { type: 'object', properties: { size: { type: 'integer' } } } },
    } }] } };
  }) };
  const manager = { getClient: vi.fn(async () => api) } as unknown as ApiClientManager;
  const auth = { getContextInfo: () => ({ namespace: 'default' }) } as OccConfigAuthProvider;
  const sendNotification = vi.fn(async (_method: string, _params: unknown) => {});
  const client = { isRunning: () => true, sendNotification } as unknown as ManagedLanguageClient;
  return { api, manager, auth, sendNotification, client };
}
describe('cluster completion feeds', () => {
  it('preserves resource names, scoped releases, and schema sections', async () => {
    const f = fixture();
    await pushResourceNames(f.client, f.manager, f.auth);
    await pushResourceSchemas(f.client, f.manager, f.auth);
    expect(f.sendNotification).toHaveBeenCalledWith('openchoreo/updateResources', expect.objectContaining({ 'ComponentRelease:app': ['r1'], Namespace: ['default'] }));
    expect(f.sendNotification).toHaveBeenCalledWith('openchoreo/updateResourceSchemas', expect.objectContaining({ ComponentType: { service: {
      parameters: expect.objectContaining({ type: 'object' }), environmentConfigs: expect.objectContaining({ type: 'object' }),
    } } }));
  });
  it('merges GitOps names without inventing cluster navigation targets or completing failed kinds', async () => {
    const f = fixture();
    const get = f.api.GET.getMockImplementation()!;
    f.api.GET.mockImplementation(async path => {
      if (path.endsWith('/traits')) throw new Error('Forbidden');
      return get(path);
    });
    const repoNames = vi.fn(() => ({ ComponentType: ['service', 'repo-only', 'repo-only'], Trait: ['repo-trait'] }));
    await pushResourceNames(f.client, f.manager, f.auth, () => true, {contextId: 'ctx', namespace: 'default', generation: 1}, repoNames);
    expect(repoNames).toHaveBeenCalledWith('default');
    const names = f.sendNotification.mock.calls.find(([method]) => method === 'openchoreo/updateResources')?.[1] as Record<string, string[]>;
    expect(names.ComponentType).toEqual(['service', 'repo-only']);
    expect(names.Trait).toBeUndefined();
    const locations = f.sendNotification.mock.calls.find(([method]) => method === 'openchoreo/updateResourceLocations')?.[1] as {resources: Array<{name: string}>};
    expect(locations.resources.some(item => item.name === 'service')).toBe(true);
    expect(locations.resources.some(item => item.name === 'repo-only' || item.name === 'repo-trait')).toBe(false);
  });
  it.each([pushResourceNames, pushResourceSchemas])('discards results fetched for an obsolete context', async push => {
    const f = fixture();
    let current = true;
    f.api.GET.mockImplementation(async () => { current = false; return { data: { items: [] } }; });
    await push(f.client, f.manager, f.auth, () => current);
    expect(f.sendNotification).not.toHaveBeenCalled();
  });
  it.each([pushResourceNames, pushResourceSchemas])('does not send to a stopped client', async push => {
    const f = fixture();
    f.client.isRunning = () => false;
    await push(f.client, f.manager, f.auth);
    expect(f.sendNotification).not.toHaveBeenCalled();
  });
  it.each([pushResourceNames, pushResourceSchemas])('handles rejected notifications without breaking explorer actions', async push => {
    const f = fixture();
    f.sendNotification.mockRejectedValueOnce(new Error('Disconnected'));
    await expect(push(f.client, f.manager, f.auth)).resolves.toBeUndefined();
  });
});

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest';
import { paginatedFetch } from '../api/paginatedFetch';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fake list endpoint serving `total` items, `pageSize` per page. */
function server(total: number, pageSize = 2) {
  const calls: URL[] = [];
  const base = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push(url);
    const start = Number(url.searchParams.get('cursor') ?? 0);
    const end = Math.min(start + pageSize, total);
    const items = Array.from({ length: end - start }, (_, i) => ({ name: `c${start + i}` }));
    return json({ items, pagination: end < total ? { nextCursor: String(end) } : {} });
  });
  return { base: base as unknown as typeof fetch, calls };
}

describe('paginatedFetch', () => {
  it('follows nextCursor and merges every page', async () => {
    const { base, calls } = server(5);
    const res = await paginatedFetch(base)('http://cp/api/v1/namespaces/default/components');
    const body = await res.json();
    expect(body.items.map((i: { name: string }) => i.name)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4']);
    expect(body.pagination.nextCursor).toBeUndefined();
    expect(calls).toHaveLength(3);
    expect(calls[0].searchParams.get('limit')).toBe('100');
    expect(calls[2].searchParams.get('cursor')).toBe('4');
  });

  it('keeps a caller limit and leaves single pages alone', async () => {
    const { base, calls } = server(1);
    const res = await paginatedFetch(base)('http://cp/api/v1/namespaces/default/projects?limit=500');
    expect((await res.json()).items).toHaveLength(1);
    expect(calls[0].searchParams.get('limit')).toBe('500');
  });

  it('passes through explicit cursors, non-GET requests and errors', async () => {
    const base = vi.fn(async () => json({ error: 'nope' }, 403)) as unknown as typeof fetch;
    const fetchAll = paginatedFetch(base);
    expect((await fetchAll('http://cp/x?cursor=abc')).status).toBe(403);
    expect((await fetchAll('http://cp/x', { method: 'POST', body: '{}' })).status).toBe(403);
    expect((await fetchAll('http://cp/x')).status).toBe(403);
    expect(new URL((base as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0].url).searchParams.get('limit')).toBeNull();
  });
});

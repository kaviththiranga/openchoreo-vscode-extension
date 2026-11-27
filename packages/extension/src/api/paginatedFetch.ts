// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/** Upper bound on pages followed for one list call (100 items each). */
const MAX_PAGES = 50;
const PAGE_SIZE = '100';

interface ListBody {
  items?: unknown[];
  pagination?: { nextCursor?: string };
}

/**
 * A fetch for the OpenChoreo API client that returns whole lists. List
 * endpoints return 20 items per page by default with `pagination.nextCursor`
 * for the rest; callers read `items` only, so a GET without a `cursor` follows
 * the cursor and merges every page into one response.
 */
export function paginatedFetch(baseFetch: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.searchParams.has('cursor')) return baseFetch(request);
    if (!url.searchParams.has('limit')) url.searchParams.set('limit', PAGE_SIZE);

    const first = await baseFetch(new Request(url, request));
    if (!first.ok || !(first.headers.get('content-type') ?? '').includes('json')) return first;
    const body = (await first.clone().json().catch(() => undefined)) as ListBody | undefined;
    if (!Array.isArray(body?.items) || !body.pagination?.nextCursor) return first;

    const items = [...body.items];
    let cursor: string | undefined = body.pagination.nextCursor;
    for (let page = 1; cursor && page < MAX_PAGES; page++) {
      url.searchParams.set('cursor', cursor);
      const next = await baseFetch(new Request(url, request));
      if (!next.ok) return next;
      const nextBody = (await next.json()) as ListBody;
      items.push(...(nextBody.items ?? []));
      cursor = nextBody.pagination?.nextCursor;
    }
    const merged: ListBody = { ...body, items, pagination: { ...body.pagination, nextCursor: undefined } };
    const headers = new Headers(first.headers);
    headers.delete('content-length');
    return new Response(JSON.stringify(merged), { status: first.status, statusText: first.statusText, headers });
  };
}

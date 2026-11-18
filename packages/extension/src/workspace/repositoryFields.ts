// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Where a component's source lives. Workflows mark their git parameters with
 * boolean `x-openchoreo-component-parameter-repository-<role>` keys in
 * `spec.parameters.openAPIV3Schema`; the control plane (auto-build) and the
 * Backstage portal read them the same way.
 */

export const REPOSITORY_ROLES = ['url', 'branch', 'commit', 'app-path', 'secret-ref'] as const;
export type RepositoryRole = (typeof REPOSITORY_ROLES)[number];

const EXTENSION_PREFIX = 'x-openchoreo-component-parameter-repository-';
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/** Role → dotted path inside the workflow parameters (e.g. `url` → `repository.url`). */
export type RepositoryPaths = Partial<Record<RepositoryRole, string>>;

export interface ComponentSource {
  url?: string;
  branch?: string;
  commit?: string;
  /** Path of the app inside the repository, without leading `./` or `/` ('' for the root). */
  appPath?: string;
}

/** Walk a workflow's parameter schema for the repository markers. */
export function repositoryPaths(schema: unknown, prefix = ''): RepositoryPaths {
  const paths: RepositoryPaths = {};
  const properties = (schema as { properties?: Record<string, unknown> } | undefined)?.properties;
  if (!properties || typeof properties !== 'object') return paths;
  for (const [name, prop] of Object.entries(properties)) {
    if (!prop || typeof prop !== 'object' || UNSAFE_KEYS.has(name)) continue;
    const path = prefix ? `${prefix}.${name}` : name;
    for (const role of REPOSITORY_ROLES) {
      if ((prop as Record<string, unknown>)[EXTENSION_PREFIX + role] === true) paths[role] = path;
    }
    Object.assign(paths, repositoryPaths(prop, path));
  }
  return paths;
}

/** The parameter schema of a Workflow or ClusterWorkflow as the API returns it. */
export function workflowParameterSchema(workflow: unknown): unknown {
  const spec = (workflow as { spec?: Record<string, unknown> } | undefined)?.spec;
  const section = (spec?.parameters ?? (spec?.schema as Record<string, unknown> | undefined)?.parameters) as
    | Record<string, unknown>
    | undefined;
  return section?.openAPIV3Schema ?? section?.ocSchema;
}

export function readPath(obj: unknown, path: string): unknown {
  let current = obj;
  for (const part of path.split('.')) {
    if (UNSAFE_KEYS.has(part) || current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function writePath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  if (parts.some((p) => UNSAFE_KEYS.has(p))) throw new Error(`Unsafe path: ${path}`);
  let current = obj;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== 'object') current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/** `/service-go-greeter`, `./api/`, `.` → `service-go-greeter`, `api`, ''. */
export function normalizeAppPath(value: string | undefined): string {
  if (!value) return '';
  return value
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p && p !== '.')
    .join('/');
}

/** Read a component's source from its workflow parameters. */
export function componentSource(parameters: unknown, paths: RepositoryPaths): ComponentSource {
  const value = (role: RepositoryRole): string | undefined => {
    const path = paths[role];
    const raw = path ? readPath(parameters, path) : undefined;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
  };
  const source: ComponentSource = {};
  const url = value('url');
  if (url) source.url = url;
  const branch = value('branch');
  if (branch) source.branch = branch;
  const commit = value('commit');
  if (commit) source.commit = commit;
  if (paths['app-path']) source.appPath = normalizeAppPath(value('app-path'));
  return source;
}

/**
 * A comparable form of a git URL: `host/owner/repo`, lowercased, without
 * scheme, credentials, port-less `git@host:` syntax, `.git` or trailing slash.
 */
export function normalizeRepoUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let value = url.trim();
  const scp = /^[\w.-]+@([^:/]+):(.+)$/.exec(value);
  if (scp) {
    value = `${scp[1]}/${scp[2]}`;
  } else {
    value = value.replace(/^[a-z+]+:\/\//i, '').replace(/^[^@/]+@/, '');
  }
  value = value.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  const [host, ...rest] = value.split('/');
  if (!host || rest.length === 0) return undefined;
  return [host.toLowerCase().replace(/:\d+$/, ''), ...rest].join('/').toLowerCase();
}

/** Browser URL for a repository (and optionally a commit), for https or scp-style remotes. */
export function repositoryWebUrl(url: string, commit?: string): string | undefined {
  const normalized = normalizeRepoUrl(url);
  if (!normalized) return undefined;
  const base = `https://${normalized}`;
  if (!commit) return base;
  return normalized.startsWith('bitbucket.org/') ? `${base}/commits/${commit}` : `${base}/commit/${commit}`;
}

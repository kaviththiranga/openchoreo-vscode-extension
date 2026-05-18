// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { frameworks as rawFrameworkList, type Framework } from '@vercel/frameworks';

// The exported constant is a deeply literal `readonly` tuple; widen it to
// Framework[] so we can treat entries uniformly.
const frameworkList = rawFrameworkList as unknown as Framework[];
import type { ComponentType, DetectionResult } from '../profile';
import type { DetectorFs } from './filesystem';

/** Map of framework slug → OpenChoreo componentType. */
const COMPONENT_TYPE_BY_SLUG: Record<string, ComponentType> = {
  // Static / SSR web apps → web-application
  nextjs: 'web-application',
  nuxtjs: 'web-application',
  sveltekit: 'web-application',
  'sveltekit-1': 'web-application',
  remix: 'web-application',
  astro: 'web-application',
  vue: 'web-application',
  svelte: 'web-application',
  angular: 'web-application',
  'create-react-app': 'web-application',
  preact: 'web-application',
  solidstart: 'web-application',
  'solidstart-1': 'web-application',
  'react-router': 'web-application',
  gatsby: 'web-application',
  vite: 'web-application',
  'tanstack-start': 'web-application',
  hydrogen: 'web-application',
  redwoodjs: 'web-application',
  docusaurus: 'web-application',
  'docusaurus-2': 'web-application',

  // API server frameworks → service
  express: 'service',
  fastify: 'service',
  nestjs: 'service',
  koa: 'service',
  hono: 'service',
  h3: 'service',
  elysia: 'service',
  nitro: 'service',
};

/**
 * Default port per framework. Falls back to the framework's devCommand hint;
 * then to 3000 for web, 8080 for services.
 */
const PORT_BY_SLUG: Record<string, number> = {
  nextjs: 3000,
  nuxtjs: 3000,
  astro: 4321,
  sveltekit: 5173,
  'sveltekit-1': 5173,
  vite: 5173,
  vue: 5173,
  remix: 3000,
  'create-react-app': 3000,
  express: 3000,
  fastify: 3000,
  nestjs: 3000,
  koa: 3000,
  hono: 3000,
  elysia: 3000,
};

/**
 * Test a Framework's detectors against the workspace.
 *
 * Matches Vercel's own detector semantics:
 * - `every` entries must all match
 * - `some` entries: at least one must match
 * - `matchPackage` = regex against package.json text
 * - `path` + `matchContent` = regex against that file's contents
 *
 * Reimplementing the ~50-line matcher here instead of pulling in
 * @vercel/fs-detectors (which imports child_process.spawnSync).
 */
async function frameworkMatches(
  fw: Framework,
  fs: DetectorFs,
  packageJsonText: string,
): Promise<boolean> {
  const detectors = fw.detectors;
  if (!detectors) return false;

  const matchOne = async (
    item: { path?: string; matchPackage?: string; matchContent?: string },
  ): Promise<boolean> => {
    if (item.matchPackage) {
      return new RegExp(item.matchPackage).test(packageJsonText);
    }
    if (item.path && item.matchContent) {
      const content = await fs.readText(item.path);
      if (content === undefined) return false;
      return new RegExp(item.matchContent).test(content);
    }
    if (item.path) {
      return fs.exists(item.path);
    }
    return false;
  };

  // `every` — all must match
  if (detectors.every) {
    for (const item of detectors.every) {
      if (!(await matchOne(item))) return false;
    }
  }
  // `some` — at least one must match (unless no `some` rules are defined)
  if (detectors.some && detectors.some.length > 0) {
    let anyMatch = false;
    for (const item of detectors.some) {
      if (await matchOne(item)) {
        anyMatch = true;
        break;
      }
    }
    if (!anyMatch) return false;
  }
  return true;
}

export async function detectNode(fs: DetectorFs): Promise<DetectionResult | undefined> {
  const packageJsonText = await fs.readText('package.json');
  if (packageJsonText === undefined) return undefined;

  // Parse name for the project identifier (best-effort).
  let pkgName: string | undefined;
  let hasBuildScript = false;
  try {
    const pkg = JSON.parse(packageJsonText);
    if (typeof pkg.name === 'string') pkgName = pkg.name;
    hasBuildScript = !!pkg.scripts?.build;
  } catch {
    // malformed package.json — still attempt framework matching
  }

  // Try framework detection in `sort` order (lower sort = more specific).
  const sorted = [...frameworkList].sort((a, b) => (a.sort ?? 99) - (b.sort ?? 99));

  for (const fw of sorted) {
    if (!fw.slug) continue;
    // Skip runtime frameworks at this stage — Go/Python/Ruby/Rust/Java handled by dedicated detectors.
    if (fw.runtimeFramework) continue;

    if (await frameworkMatches(fw, fs, packageJsonText)) {
      const signals = [`package.json matched framework "${fw.name}" (slug: ${fw.slug})`];
      if (pkgName) signals.push(`package.json name: ${pkgName}`);

      const componentType = COMPONENT_TYPE_BY_SLUG[fw.slug] ?? 'service';
      const port = PORT_BY_SLUG[fw.slug] ?? (componentType === 'web-application' ? 3000 : 8080);

      const result: DetectionResult = {
        language: 'node',
        framework: fw.slug,
        frameworkName: fw.name,
        componentType,
        port,
        confidence: 'high',
        signals,
      };

      // BP_NODE_RUN_SCRIPTS hint for Paketo buildpacks.
      if (hasBuildScript) {
        result.env = [{ key: 'BP_NODE_RUN_SCRIPTS', value: 'build' }];
        signals.push('package.json has "build" script → BP_NODE_RUN_SCRIPTS hint');
      }
      return result;
    }
  }

  // Node.js project but no known framework — still a valid detection.
  return {
    language: 'node',
    componentType: 'service',
    port: 3000,
    confidence: 'medium',
    signals: ['Found package.json (no known framework matched)'],
    env: hasBuildScript ? [{ key: 'BP_NODE_RUN_SCRIPTS', value: 'build' }] : undefined,
  };
}

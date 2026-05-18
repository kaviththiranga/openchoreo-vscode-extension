// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { DetectionResult } from '../profile';
import type { DetectorFs } from './filesystem';

const FRAMEWORK_IMPORTS: Array<{ match: RegExp; slug: string; name: string }> = [
  { match: /["']github\.com\/gin-gonic\/gin["']/, slug: 'gin', name: 'Gin' },
  { match: /["']github\.com\/labstack\/echo(?:\/v\d+)?["']/, slug: 'echo', name: 'Echo' },
  { match: /["']github\.com\/gofiber\/fiber(?:\/v\d+)?["']/, slug: 'fiber', name: 'Fiber' },
  { match: /["']github\.com\/go-chi\/chi(?:\/v\d+)?["']/, slug: 'chi', name: 'Chi' },
  { match: /["']github\.com\/gorilla\/mux["']/, slug: 'gorilla-mux', name: 'Gorilla Mux' },
];

/** Parse the `module` directive from go.mod. */
function parseModuleName(goMod: string): string | undefined {
  const match = /^\s*module\s+(\S+)/m.exec(goMod);
  if (!match) return undefined;
  // Module path is like github.com/foo/bar; extract the last segment as the project name.
  const modulePath = match[1];
  const parts = modulePath.split('/');
  return parts[parts.length - 1] || undefined;
}

async function findMainGoFiles(fs: DetectorFs): Promise<string[]> {
  const candidates: string[] = [];
  if (await fs.exists('main.go')) candidates.push('main.go');

  // Scan cmd/*/main.go — common Go layout for multi-binary repos.
  const cmdEntries = await fs.list('cmd');
  for (const entry of cmdEntries) {
    const path = `cmd/${entry}/main.go`;
    if (await fs.exists(path)) candidates.push(path);
  }
  return candidates;
}

export async function detectGo(fs: DetectorFs): Promise<DetectionResult | undefined> {
  const goMod = await fs.readText('go.mod');
  if (goMod === undefined) return undefined;

  const signals = ['Found go.mod'];
  const moduleName = parseModuleName(goMod);
  if (moduleName) signals.push(`Go module: ${moduleName}`);

  // Look for framework imports — first in go.mod (require blocks), then in main.go files.
  let framework: { slug: string; name: string } | undefined;
  for (const fw of FRAMEWORK_IMPORTS) {
    if (fw.match.test(goMod)) {
      framework = { slug: fw.slug, name: fw.name };
      break;
    }
  }

  if (!framework) {
    const mainFiles = await findMainGoFiles(fs);
    for (const path of mainFiles) {
      const text = await fs.readText(path);
      if (!text) continue;
      for (const fw of FRAMEWORK_IMPORTS) {
        if (fw.match.test(text)) {
          framework = { slug: fw.slug, name: fw.name };
          signals.push(`${path} imports ${fw.name}`);
          break;
        }
      }
      if (framework) break;
    }
  } else {
    signals.push(`go.mod requires ${framework.name}`);
  }

  return {
    language: 'go',
    framework: framework?.slug,
    frameworkName: framework?.name,
    componentType: 'service',
    port: 8080,
    confidence: framework ? 'high' : 'medium',
    signals,
  };
}

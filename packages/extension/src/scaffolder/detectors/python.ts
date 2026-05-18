// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { DetectionResult } from '../profile';
import type { DetectorFs } from './filesystem';

interface PyFramework {
  slug: string;
  name: string;
  match: RegExp;
  defaultPort: number;
}

const FRAMEWORKS: PyFramework[] = [
  { slug: 'fastapi', name: 'FastAPI', match: /\bfastapi\b/i, defaultPort: 8000 },
  { slug: 'django', name: 'Django', match: /\bdjango\b/i, defaultPort: 8000 },
  { slug: 'flask', name: 'Flask', match: /\bflask\b/i, defaultPort: 5000 },
  { slug: 'starlette', name: 'Starlette', match: /\bstarlette\b/i, defaultPort: 8000 },
];

function detectFromText(text: string): PyFramework | undefined {
  for (const fw of FRAMEWORKS) {
    if (fw.match.test(text)) return fw;
  }
  return undefined;
}

export async function detectPython(fs: DetectorFs): Promise<DetectionResult | undefined> {
  // Try the dependency manifest files in the order most projects prefer.
  const sources: Array<{ path: string; label: string }> = [
    { path: 'pyproject.toml', label: 'pyproject.toml' },
    { path: 'requirements.txt', label: 'requirements.txt' },
    { path: 'Pipfile', label: 'Pipfile' },
    { path: 'setup.py', label: 'setup.py' },
  ];

  let manifestText: string | undefined;
  let manifestLabel: string | undefined;
  for (const src of sources) {
    const text = await fs.readText(src.path);
    if (text !== undefined) {
      manifestText = text;
      manifestLabel = src.label;
      break;
    }
  }

  if (manifestText === undefined) return undefined;

  const signals = [`Found ${manifestLabel}`];
  const framework = detectFromText(manifestText);
  if (framework) signals.push(`${manifestLabel} depends on ${framework.name}`);

  return {
    language: 'python',
    framework: framework?.slug,
    frameworkName: framework?.name,
    componentType: 'service',
    port: framework?.defaultPort ?? 8000,
    confidence: framework ? 'high' : 'medium',
    signals,
  };
}

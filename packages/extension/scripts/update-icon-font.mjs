// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * After running fantasticon, update package.json contributes.icons
 * from the generated openchoreo-icons.json codepoint map.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const codepoints = JSON.parse(
  readFileSync(resolve(root, 'resources', 'openchoreo-icons.json'), 'utf8'),
);

const descriptions = {
  'logo': 'OpenChoreo logo',
  'apartment': 'Namespace',
  'dashboard': 'Project',
  'memory': 'Component',
  'storage': 'Workload',
  'cloud': 'Environment',
  'dns': 'Data Plane',
  'build': 'Workflow Plane',
  'visibility': 'Observability Plane',
  'category': 'Component Type',
  'extension': 'Trait',
  'play-circle-outline': 'Workflow',
  'account-tree': 'Deployment Pipeline',
  'security': 'Role',
  'link': 'Role Binding',
};

const icons = {};
for (const [name, code] of Object.entries(codepoints)) {
  const id = `openchoreo-${name}`;
  icons[id] = {
    description: descriptions[name] ?? name,
    default: {
      fontPath: 'resources/openchoreo-icons.woff2',
      fontCharacter: String.fromCodePoint(code),
    },
  };
}

const pkgPath = resolve(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.contributes.icons = icons;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

console.log(`Updated ${Object.keys(icons).length} icons in package.json`);

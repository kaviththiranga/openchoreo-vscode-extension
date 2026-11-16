// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Regenerates schemas/*.json from the OpenChoreo CRDs at a release tag.
 *
 *   node scripts/generate-schemas.mjs --openchoreo ~/git/openchoreo --ref v1.3.3
 *
 * Reads config/crd/bases/*.yaml from a local openchoreo checkout (via git, so
 * any fetched tag works without checking it out), converts each CRD's
 * openAPIV3Schema to the JSON Schema dialect the language server reads, and
 * re-applies the resource references in schemas/refs.json.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemasDir = path.resolve(here, '../../../schemas');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}
const repo = arg('openchoreo');
const ref = arg('ref', 'v1.3.3');
if (!repo) {
  console.error('usage: generate-schemas.mjs --openchoreo <path-to-openchoreo-checkout> [--ref <tag>]');
  process.exit(1);
}

const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8', maxBuffer: 64 << 20 });
const crdFiles = git('ls-tree', '--name-only', ref, 'config/crd/bases/').trim().split('\n').filter((f) => f.endsWith('.yaml'));
const refs = JSON.parse(fs.readFileSync(path.join(schemasDir, 'refs.json'), 'utf-8'));

/**
 * Convert a CRD structural schema node. Kubernetes prunes unknown fields, so
 * objects with declared properties are closed (additionalProperties: false)
 * unless the CRD keeps unknown fields. The validator reports unknown keys as
 * warnings, which catches typos the API server would silently drop.
 */
function convert(node) {
  if (Array.isArray(node)) return node.map(convert);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('x-kubernetes-')) continue;
    out[key] = key === 'properties'
      ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, convert(v)]))
      : convert(value);
  }
  if (node['x-kubernetes-int-or-string']) {
    delete out.type;
    out.anyOf = [{ type: 'integer' }, { type: 'string' }];
  }
  const preserve = node['x-kubernetes-preserve-unknown-fields'] === true;
  if (out.type === 'object' && out.properties && out.additionalProperties === undefined && !preserve) {
    out.additionalProperties = false;
  }
  return out;
}

/** Resolve a dotted refs.json path ("spec.traits[].name") inside a schema. */
function nodeAt(schema, dotted) {
  let cur = schema;
  for (const step of dotted.split('.')) {
    const isArray = step.endsWith('[]');
    const key = isArray ? step.slice(0, -2) : step;
    cur = cur?.properties?.[key];
    if (isArray) cur = cur?.items;
  }
  return cur;
}

const kinds = [];
for (const file of crdFiles) {
  const crd = parseYaml(git('show', `${ref}:${file}`));
  const kind = crd.spec.names.kind;
  const namespaced = crd.spec.scope === 'Namespaced';
  const version = crd.spec.versions.find((v) => v.storage) ?? crd.spec.versions[0];
  const root = version.schema.openAPIV3Schema;
  const spec = root.properties?.spec ? convert(root.properties.spec) : undefined;

  const metadata = {
    type: 'object',
    properties: {
      name: { type: 'string', description: `Name of the ${kind}` },
      ...(namespaced
        ? { namespace: { type: 'string', description: 'Namespace', 'x-openchoreo-ref': 'Namespace' } }
        : {}),
      labels: { type: 'object', additionalProperties: { type: 'string' } },
      annotations: { type: 'object', additionalProperties: { type: 'string' } },
    },
    required: ['name'],
  };

  const required = ['apiVersion', 'kind', 'metadata'];
  if (spec && ((root.required ?? []).includes('spec') || (spec.required ?? []).length > 0)) {
    required.push('spec');
  }

  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    'x-openchoreo-kind': kind,
    'x-openchoreo-source': `openchoreo/openchoreo ${ref} ${file}`,
    title: `OpenChoreo ${kind}`,
    ...(root.description ? { description: root.description } : {}),
    type: 'object',
    properties: {
      apiVersion: { type: 'string', const: 'openchoreo.dev/v1alpha1' },
      kind: { type: 'string', const: kind },
      metadata,
      ...(spec ? { spec } : {}),
    },
    required,
  };

  for (const [dotted, refKind] of Object.entries(refs[kind] ?? {})) {
    const target = nodeAt(schema, dotted);
    if (!target) throw new Error(`refs.json: ${kind} has no field ${dotted} at ${ref}`);
    target['x-openchoreo-ref'] = refKind;
  }

  fs.writeFileSync(path.join(schemasDir, `${kind.toLowerCase()}.json`), `${JSON.stringify(schema, null, 2)}\n`);
  kinds.push(kind);
}
console.log(`Generated ${kinds.length} schemas from ${ref}: ${kinds.join(', ')}`);

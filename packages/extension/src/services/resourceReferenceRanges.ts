// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0
import { isMap, isScalar, isSeq, parseAllDocuments } from 'yaml';
import { KIND_REGISTRY } from '../kinds/registry';

export interface ResourceReferenceRange { start: number; end: number; value: string; }
const kinds = new Set(KIND_REGISTRY.map(spec => spec.kind));
const inferredFields = /^(componentType|clusterComponentType|traits?|allowedTraits|workflows?|allowedWorkflows|type|deploymentPipelineRef|project|component|resource|environment|targetEnvironmentRefs|environmentRefs|endpoint|endpointType)$/;
const pins = new Set(['releaseName', 'resourceRelease', 'projectRelease']);
const excluded = new Set(['metadata', 'template', 'parameters', 'environmentConfigs']);

/** YAML offsets are UTF-16 offsets, matching TextDocument.positionAt. */
export function resourceReferenceRanges(text: string): ResourceReferenceRange[] {
  const result: ResourceReferenceRange[] = [];
  const add = (value: unknown) => {
    if (!isScalar(value) || typeof value.value !== 'string' || !value.range) return;
    if (!value.value || value.value.includes('${') || value.value.startsWith('$')) return;
    let [start, end] = value.range;
    const raw = text.slice(start, end);
    if (raw.includes('\n')) return;
    if (value.type === 'QUOTE_SINGLE' || value.type === 'QUOTE_DOUBLE') { start++; end--; }
    if (end > start) result.push({ start, end, value: value.value });
  };
  const walk = (node: unknown, path: string[]) => {
    if (path.some(part => excluded.has(part))) return;
    if (isSeq(node)) {
      for (const item of node.items) walk(item, path);
    } else if (isMap(node)) {
      const kind = node.get('kind');
      for (const pair of node.items) {
        if (!isScalar(pair.key) || typeof pair.key.value !== 'string') continue;
        const key = pair.key.value;
        if (path[0] === 'spec' && ((key === 'name' && (kinds.has(String(kind)) || inferredFields.test(path.at(-1) ?? ''))) || pins.has(key))) add(pair.value);
        walk(pair.value, [...path, key]);
      }
    }
  };
  try {
    for (const doc of parseAllDocuments(text)) {
      const version = doc.get('apiVersion');
      if (typeof version === 'string' && version.startsWith('openchoreo.dev/')) walk(doc.contents, []);
    }
  } catch { /* Incomplete documents are retried on the next edit. */ }
  return result;
}

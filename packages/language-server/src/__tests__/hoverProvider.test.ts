// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getHoverInfo } from '../hover/hoverProvider';
import { loadSchemas } from '../schemas/schemaLoader';

const schemas = loadSchemas(path.resolve(__dirname, '../../../../schemas'));
const text = [
  'apiVersion: openchoreo.dev/v1alpha1',
  'kind: Project',
  'metadata:',
  '  name: shop',
  '  namespace: default',
  'spec:',
  '  type:',
  '    kind: ClusterProjectType',
  '    name: default',
  '  deploymentPipelineRef:',
  '    name: standard',
].join('\n');
const doc = TextDocument.create('file:///p.yaml', 'yaml', 1, text);
const hoverAt = (line: number, character: number) => {
  const h = getHoverInfo(doc, { line, character }, schemas.Project!);
  return h && typeof h.contents === 'object' && 'value' in h.contents ? h.contents.value : undefined;
};

describe('getHoverInfo', () => {
  it('documents a key nested under its parent', () => {
    expect(hoverAt(6, 3)).toContain('**spec.type**');
  });

  it('resolves a key that follows a sibling with nested children', () => {
    expect(hoverAt(9, 4)).toContain('**spec.deploymentPipelineRef**');
    expect(hoverAt(9, 4)).toContain('DeploymentPipeline');
  });

  it('resolves a top-level key that follows a nested block', () => {
    expect(hoverAt(5, 1)).toContain('**spec**');
  });

  it('resolves the second of two sibling leaves', () => {
    expect(hoverAt(8, 5)).toContain('**spec.type.name**');
  });
});

describe('getHoverInfo in list items', () => {
  const component = [
    'apiVersion: openchoreo.dev/v1alpha1',
    'kind: Component',
    'metadata:',
    '  name: api',
    'spec:',
    '  traits:',
    '    - name: storage',
    '      kind: ClusterTrait',
    '      instanceName: data',
  ].join('\n');
  const listDoc = TextDocument.create('file:///c.yaml', 'yaml', 1, component);
  const at = (line: number, character: number) => {
    const h = getHoverInfo(listDoc, { line, character }, schemas.Component!);
    return h && typeof h.contents === 'object' && 'value' in h.contents ? h.contents.value : undefined;
  };

  it('documents the first key of an item, on its `- key:` line', () => {
    expect(at(6, 7)).toContain('**spec.traits[].name**');
  });

  it('documents the later keys of an item', () => {
    expect(at(7, 7)).toContain('**spec.traits[].kind**');
    expect(at(8, 8)).toContain('**spec.traits[].instanceName**');
  });

  it('stays silent off a key', () => {
    expect(at(6, 14)).toBeUndefined();
  });
});

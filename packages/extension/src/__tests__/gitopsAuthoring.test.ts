// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { parseDocument, type Node as YamlNode } from 'yaml';
import * as fs from 'fs';
import { parse } from 'yaml';
import { fileSystemConfig, gitError, parseGenerateOutput, runOcc, scopes } from '../gitops/generate';
import { referenceAt, scalarAt } from '../gitops/definitions';
import { isSubset } from '../gitops/syncView';
import type { RepoEntry } from '../gitops/repoIndex';

describe('occ generate output', () => {
  // Captured from occ 1.4.0-m.1 against openchoreo/sample-gitops.
  it('reads generated files and the summary', () => {
    const out = `Loading index...
Generated: /repo/namespaces/default/projects/doclet/components/frontend/releases/frontend-20261118-1.yaml
Generated: /repo/namespaces/default/projects/doclet/components/collab-svc/releases/collab-svc-20261118-1.yaml

Summary: 2 releases generated, 0 unchanged (skipped), 0 errors
`;
    expect(parseGenerateOutput(out)).toEqual({
      generated: [
        '/repo/namespaces/default/projects/doclet/components/frontend/releases/frontend-20261118-1.yaml',
        '/repo/namespaces/default/projects/doclet/components/collab-svc/releases/collab-svc-20261118-1.yaml',
      ],
      errors: [],
      summary: '2 releases generated, 0 unchanged (skipped), 0 errors',
    });
  });

  it('reads per-component errors', () => {
    const out = `Loading index...
Error generating binding for component doclet/frontend: generate binding: no ReleaseBinding found in previous environment "development" for component doclet/frontend; create binding in "development" first or specify --component-release explicitly

Summary: 0 bindings generated, 1 errors
`;
    const result = parseGenerateOutput(out);
    expect(result.generated).toEqual([]);
    expect(result.errors[0]).toMatch(/^Error generating binding for component doclet\/frontend/);
    expect(result.summary).toBe('0 bindings generated, 1 errors');
  });

  it('reads releasebinding output', () => {
    // releasebinding says "Created:" where componentrelease says "Generated:".
    const out = 'Created: /repo/namespaces/gitops-demo/projects/shop/components/greeter/release-bindings/greeter-development.yaml\n\nSummary: 1 bindings generated, 0 errors\n';
    expect(parseGenerateOutput(out).generated).toHaveLength(1);
  });

  it('writes a file-system context for the namespace', () => {
    expect(parse(fileSystemConfig('gitops-demo', '/repo'))).toEqual({
      currentContext: 'gitops',
      contexts: [{ name: 'gitops', namespace: 'gitops-demo', mode: 'file-system', rootDirectoryPath: '/repo' }],
    });
  });

  const fork = `${process.env.HOME}/git/openchoreo-sample-gitops`;
  it.skipIf(!fs.existsSync(`${fork}/namespaces/gitops-demo`))('runs occ releasebinding for a namespace it has no flag for', async () => {
    const out = await runOcc(
      'occ',
      ['releasebinding', 'generate', '--project', 'shop', '--target-env', 'staging', '--use-pipeline', 'standard', '--dry-run', '--mode', 'file-system', '--root-dir', fork],
      fork,
      'gitops-demo',
      () => {},
    );
    expect(out).toContain('greeter');
    expect(out).not.toMatch(/not found in namespace "default"/);
  });

  it('offers all, per-project and per-component scopes', () => {
    const entry = (kind: string, name: string, path: string) =>
      ({ kind, name, namespace: 'default', uri: vscode.Uri.file(path), docIndex: 0, line: 0 }) as unknown as RepoEntry;
    const list = scopes([
      entry('Project', 'doclet', '/r/namespaces/default/projects/doclet/project.yaml'),
      entry('Component', 'frontend', '/r/namespaces/default/projects/doclet/components/frontend/component.yaml'),
    ]);
    expect(list.map((s) => s.args)).toEqual([['--all'], ['--project', 'doclet'], ['--project', 'doclet', '--component', 'frontend']]);
    expect(list.map((s) => s.slug)).toEqual(['all', 'doclet', 'doclet-frontend']);
    expect(list.map((s) => s.namespace)).toEqual(['default', 'default', 'default']);
  });
});

describe('references', () => {
  const none = () => undefined;
  it('maps reference fields to the kinds they name', () => {
    expect(referenceAt('Component', ['spec', 'componentType', 'name'], 'deployment/web-application', (k) => (k === 'kind' ? 'ComponentType' : undefined))).toEqual({
      kinds: ['ComponentType'],
      name: 'web-application',
      workloadType: 'deployment',
    });
    expect(referenceAt('Component', ['spec', 'traits', 0, 'name'], 'storage', none)).toEqual({ kinds: ['ClusterTrait', 'Trait'], name: 'storage' });
    expect(referenceAt('ReleaseBinding', ['spec', 'environment'], 'staging', none)).toEqual({ kinds: ['Environment'], name: 'staging' });
    expect(referenceAt('ReleaseBinding', ['spec', 'releaseName'], 'api-1', none)).toEqual({ kinds: ['ComponentRelease'], name: 'api-1' });
    expect(referenceAt('ProjectReleaseBinding', ['spec', 'releaseName'], 'shop-1', none)?.kinds).toEqual(['ProjectRelease']);
    expect(referenceAt('DeploymentPipeline', ['spec', 'promotionPaths', 0, 'targetEnvironmentRefs', 1, 'name'], 'prod', none)?.kinds).toEqual(['Environment']);
    expect(referenceAt('Project', ['spec', 'deploymentPipelineRef', 'name'], 'standard', none)?.kinds).toEqual(['DeploymentPipeline']);
    expect(referenceAt('Component', ['metadata', 'name'], 'api', none)).toBeUndefined();
  });

  it('finds the scalar under the cursor with its path', () => {
    const text = 'kind: Component\nspec:\n  traits:\n    - name: storage\n      kind: Trait\n';
    const doc = parseDocument(text);
    const hit = scalarAt(doc.contents as YamlNode, text.indexOf('storage') + 2);
    expect(hit?.path).toEqual(['spec', 'traits', 0, 'name']);
    expect(hit?.value).toBe('storage');
    expect(scalarAt(doc.contents as YamlNode, text.indexOf('spec'))).toBeUndefined();
  });
});

describe('sync state', () => {
  it('treats fields the cluster adds as in sync', () => {
    expect(isSubset({ spec: { port: 8080, name: 'a' } }, { spec: { port: 8080, name: 'a', replicas: 1 }, metadata: {} })).toBe(true);
    expect(isSubset({ spec: { port: '8080' } }, { spec: { port: 8080 } })).toBe(true);
    expect(isSubset({ spec: { port: 8080 } }, { spec: { port: 9090 } })).toBe(false);
    expect(isSubset({ spec: { list: [1, 2] } }, { spec: { list: [1] } })).toBe(false);
    // The API omits zero values.
    expect(isSubset({ spec: { isProduction: false, a: {}, env: [], n: 0 } }, { spec: {} })).toBe(true);
    expect(isSubset({ spec: { isProduction: true } }, { spec: {} })).toBe(false);
    expect(isSubset({ spec: { a: { b: 'x' } } }, { spec: {} })).toBe(false);
  });
});

describe('git errors', () => {
  it("shows git's own message instead of the Git extension's", () => {
    const err = Object.assign(new Error('Failed to execute git'), { stderr: '\nAuthor identity unknown\n\n*** Please tell me who you are.\n' });
    expect(gitError(err)).toBe('Author identity unknown');
    expect(gitError(Object.assign(new Error('x'), { stderr: 'hint: foo\nfatal: not a git repository\n' }))).toBe('fatal: not a git repository');
    expect(gitError(new Error('Failed to execute git'))).toBe('Failed to execute git');
  });
});

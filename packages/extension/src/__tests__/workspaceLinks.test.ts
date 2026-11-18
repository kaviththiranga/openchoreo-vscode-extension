// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import {
  componentSource,
  normalizeAppPath,
  normalizeRepoUrl,
  repositoryPaths,
  repositoryWebUrl,
  workflowParameterSchema,
  writePath,
} from '../workspace/repositoryFields';
import { linksForPath, matchComponents, type FolderGitInfo } from '../workspace/componentLinks';
import type { SourcedComponent } from '../workspace/componentSources';

// The dockerfile-builder ClusterWorkflow as the API serves it (trimmed).
const dockerfileBuilder = {
  spec: {
    parameters: {
      openAPIV3Schema: {
        type: 'object',
        properties: {
          docker: { type: 'object', properties: { context: { type: 'string' } } },
          repository: {
            type: 'object',
            properties: {
              url: { type: 'string', 'x-openchoreo-component-parameter-repository-url': true },
              secretRef: { type: 'string', 'x-openchoreo-component-parameter-repository-secret-ref': true },
              revision: {
                type: 'object',
                properties: {
                  branch: { type: 'string', 'x-openchoreo-component-parameter-repository-branch': true },
                  commit: { type: 'string', 'x-openchoreo-component-parameter-repository-commit': true },
                },
              },
              appPath: { type: 'string', 'x-openchoreo-component-parameter-repository-app-path': true },
            },
          },
        },
      },
    },
  },
};

describe('repository fields', () => {
  it('finds the marked parameters in a workflow schema', () => {
    expect(repositoryPaths(workflowParameterSchema(dockerfileBuilder))).toEqual({
      url: 'repository.url',
      'secret-ref': 'repository.secretRef',
      branch: 'repository.revision.branch',
      commit: 'repository.revision.commit',
      'app-path': 'repository.appPath',
    });
  });

  it('finds markers under any field names', () => {
    const schema = {
      properties: { source: { properties: { gitUrl: { 'x-openchoreo-component-parameter-repository-url': true } } } },
    };
    expect(repositoryPaths(schema)).toEqual({ url: 'source.gitUrl' });
  });

  it('reads the older spec.schema.parameters.ocSchema shape', () => {
    const wf = { spec: { schema: { parameters: { ocSchema: { properties: { u: { 'x-openchoreo-component-parameter-repository-url': true } } } } } } };
    expect(repositoryPaths(workflowParameterSchema(wf))).toEqual({ url: 'u' });
  });

  it('reads a component source from its workflow parameters', () => {
    const paths = repositoryPaths(workflowParameterSchema(dockerfileBuilder));
    const parameters = {
      repository: { url: 'https://github.com/openchoreo/sample-workloads', revision: { branch: 'main' }, appPath: '/service-go-greeter' },
    };
    expect(componentSource(parameters, paths)).toEqual({
      url: 'https://github.com/openchoreo/sample-workloads',
      branch: 'main',
      appPath: 'service-go-greeter',
    });
  });

  it('normalizes app paths', () => {
    expect(normalizeAppPath('.')).toBe('');
    expect(normalizeAppPath('./api/')).toBe('api');
    expect(normalizeAppPath('/services/api')).toBe('services/api');
    expect(normalizeAppPath(undefined)).toBe('');
  });

  it('normalizes git URLs across https, ssh and scp syntax', () => {
    const expected = 'github.com/openchoreo/sample-workloads';
    for (const url of [
      'https://github.com/openchoreo/sample-workloads',
      'https://github.com/openchoreo/sample-workloads.git',
      'https://github.com/OpenChoreo/sample-workloads/',
      'git@github.com:openchoreo/sample-workloads.git',
      'ssh://git@github.com/openchoreo/sample-workloads.git',
      'https://token@github.com/openchoreo/sample-workloads',
    ]) {
      expect(normalizeRepoUrl(url), url).toBe(expected);
    }
    expect(normalizeRepoUrl('not-a-url')).toBeUndefined();
  });

  it('builds browser URLs', () => {
    expect(repositoryWebUrl('git@github.com:acme/api.git', 'abc123')).toBe('https://github.com/acme/api/commit/abc123');
  });

  it('refuses prototype paths when writing', () => {
    expect(() => writePath({}, '__proto__.x', 1)).toThrow();
    const obj: Record<string, unknown> = {};
    writePath(obj, 'repository.revision.commit', 'abc');
    expect(obj).toEqual({ repository: { revision: { commit: 'abc' } } });
  });
});

const component = (name: string, url: string | undefined, appPath: string): SourcedComponent => ({
  namespace: 'default',
  project: 'shop',
  name,
  url,
  appPath,
  paths: {},
  parameters: {},
  autoBuild: false,
});

const folder = (fsPath: string, repoRoot: string, pathInRepo: string, remoteUrls: string[]): FolderGitInfo => ({
  folder: vscode.Uri.file(fsPath) as vscode.Uri,
  repoRoot: vscode.Uri.file(repoRoot) as vscode.Uri,
  pathInRepo,
  remoteUrls,
});

describe('linking folders to components', () => {
  const components = [
    component('greeter', 'https://github.com/openchoreo/sample-workloads', 'service-go-greeter'),
    component('react', 'https://github.com/openchoreo/sample-workloads.git', 'webapp-react'),
    component('other', 'https://github.com/acme/other', ''),
    component('image-only', undefined, ''),
  ];

  it('links a monorepo root to every component built from it', () => {
    const links = matchComponents(
      [folder('/w/sample-workloads', '/w/sample-workloads', '', ['git@github.com:openchoreo/sample-workloads.git'])],
      components,
    );
    expect(links.map((l) => [l.component.name, l.match, l.appDir])).toEqual([
      ['greeter', 'contains', '/w/sample-workloads/service-go-greeter'],
      ['react', 'contains', '/w/sample-workloads/webapp-react'],
    ]);
  });

  it('ranks the exact app folder first and ignores siblings', () => {
    const links = matchComponents(
      [folder('/w/s/service-go-greeter', '/w/s', 'service-go-greeter', ['https://github.com/openchoreo/sample-workloads'])],
      components,
    );
    expect(links.map((l) => [l.component.name, l.match])).toEqual([['greeter', 'exact']]);
  });

  it('links a folder inside a component that builds from the repository root', () => {
    const links = matchComponents([folder('/w/other/src', '/w/other', 'src', ['https://github.com/acme/other'])], components);
    expect(links.map((l) => [l.component.name, l.match])).toEqual([['other', 'inside']]);
  });

  it('needs a matching remote', () => {
    expect(matchComponents([folder('/w/x', '/w/x', '', ['https://github.com/acme/x'])], components)).toEqual([]);
    expect(matchComponents([folder('/w/x', '/w/x', '', [])], components)).toEqual([]);
  });

  it('finds the component a file belongs to, deepest first', () => {
    const links = matchComponents(
      [folder('/w/s', '/w/s', '', ['https://github.com/openchoreo/sample-workloads'])],
      [...components, component('nested', 'https://github.com/openchoreo/sample-workloads', 'service-go-greeter/worker')],
    );
    expect(linksForPath(links, '/w/s/service-go-greeter/worker/main.go').map((l) => l.component.name)).toEqual([
      'nested',
      'greeter',
    ]);
    expect(linksForPath(links, '/w/s/service-go-greeter-v2/main.go')).toEqual([]);
  });
});

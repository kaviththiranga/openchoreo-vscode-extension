// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import * as YAML from 'yaml';
import { renderComponentYaml } from '../scaffolder/renderers/component';
import type { ProjectProfile } from '../scaffolder/profile';

const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../schemas/component.json'), 'utf8'));
const typePattern = new RegExp(schema.properties.spec.properties.componentType.properties.name.pattern);

const profile = (over: Partial<ProjectProfile>): ProjectProfile => ({
  projectName: 'greeter',
  language: 'node',
  componentType: 'service',
  workflow: { name: 'paketo-buildpacks-builder' },
  confidence: 'high',
  signals: [],
  ...over,
});
const render = (p: ProjectProfile, source?: Parameters<typeof renderComponentYaml>[1]['source']) =>
  YAML.parse(renderComponentYaml(p, { namespace: 'default', projectRef: 'shop', source })).spec;

describe('renderComponentYaml', () => {
  it.each([
    ['service', 'deployment/service'],
    ['web-application', 'deployment/web-application'],
    ['worker', 'deployment/worker'],
    ['scheduled-task', 'cronjob/scheduled-task'],
  ] as const)('names a %s as %s on a ClusterComponentType', (componentType, name) => {
    const spec = render(profile({ componentType }));
    expect(spec.componentType).toEqual({ kind: 'ClusterComponentType', name });
    expect(name).toMatch(typePattern);
  });

  it('builds from the folder in its repository', () => {
    const spec = render(profile({}), { url: 'https://github.com/acme/shop', branch: 'dev', appPath: 'services/greeter' });
    expect(spec.workflow).toEqual({
      kind: 'ClusterWorkflow',
      name: 'paketo-buildpacks-builder',
      parameters: {
        repository: { url: 'https://github.com/acme/shop', revision: { branch: 'dev' }, appPath: './services/greeter' },
      },
    });
  });

  it('points dockerfile-builder at the Dockerfile relative to the repository root', () => {
    const spec = render(profile({ workflow: { name: 'dockerfile-builder' } }), { url: 'https://github.com/acme/shop', appPath: 'api' });
    expect(spec.workflow.parameters.docker).toEqual({ context: './api', filePath: './api/Dockerfile' });
    expect(spec.workflow.parameters.repository.revision).toEqual({ branch: 'main' });
  });

  it('writes a placeholder repository when the folder has no remote', () => {
    const spec = render(profile({ workflow: { name: 'dockerfile-builder' } }));
    expect(spec.workflow.parameters.repository.url).toBe('https://github.com/my-org/my-repo');
    expect(spec.workflow.parameters.docker).toEqual({ context: '.', filePath: './Dockerfile' });
  });
});

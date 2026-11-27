// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { ResourceExplorerProvider } from '../treeView/resourceExplorer';
import type { ResourceNodeData } from '../treeView/types';

/** The sidebar's Release Bindings of a component, against a fake API. */
async function bindings(componentType: string): Promise<ResourceNodeData[]> {
  const api = {
    GET: async (path: string) => {
      if (path.endsWith('/components/{componentName}')) return { data: { spec: { componentType: { kind: 'ClusterComponentType', name: componentType } } } };
      if (path.endsWith('/workloads')) return { data: { items: [] } };
      if (path.endsWith('/releasebindings')) return { data: { items: [{ metadata: { name: 'job-development' }, spec: { environment: 'development', releaseName: 'job-1' } }] } };
      if (path.endsWith('/projects/{projectName}')) return { data: { spec: { deploymentPipelineRef: { name: 'default' } } } };
      if (path.endsWith('/deploymentpipelines/{deploymentPipelineName}')) {
        return { data: { spec: { promotionPaths: [{ sourceEnvironmentRef: { name: 'development' }, targetEnvironmentRefs: [{ name: 'staging' }] }] } } };
      }
      return { data: { items: [] } };
    },
  };
  const explorer = new ResourceExplorerProvider(
    { onDidChangeSession: () => ({ dispose() {} }) } as never,
    { getClient: async () => api } as never,
    { canDelete: () => false } as never,
    {} as never,
    {} as never,
  );
  const base = { namespace: 'default', project: 'shop', component: 'job' };
  const children = await explorer.getChildren({ ...base, label: 'job', type: 'component', contextValue: 'component', childrenMode: 'lazy', lazyChildrenKey: 'component-children' });
  const category = children.find((c) => c.lazyChildrenKey === 'release-bindings')!;
  return explorer.getChildren(category);
}

describe('release binding nodes', () => {
  it('offer Run Now only for scheduled tasks (cronjob components)', async () => {
    const [scheduled] = await bindings('cronjob/scheduled-task');
    expect(scheduled.type).toBe('release-binding');
    expect(scheduled.contextValue).toContain('_scheduled');
    const [service] = await bindings('deployment/service');
    expect(service.type).toBe('release-binding');
    expect(service.contextValue).not.toContain('_scheduled');
    expect(service.contextValue).toContain('_promotable');
  });
});

describe('release binding menus', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));

  it('show Run Now on scheduled-task bindings only', () => {
    const entry = manifest.contributes.menus['webview/context'].find((m: { command: string }) => m.command === 'openchoreo.runScheduledTaskNow');
    expect(entry.when).toContain('isScheduledTask');
  });

  it('end titles that ask for more input with a single ellipsis character', () => {
    for (const { title } of manifest.contributes.commands as Array<{ title: string }>) expect(title).not.toMatch(/\.\.\.$/);
  });
});

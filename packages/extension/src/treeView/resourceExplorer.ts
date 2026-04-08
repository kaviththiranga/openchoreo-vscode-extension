// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { OccConfigAuthProvider } from '../auth/authProvider';
import type { ApiClientManager } from '../api/apiClient';
import type { CapabilityService } from '../services/capabilityService';
import type { WorkflowRunService } from '../services/workflowRunService';
import type {
  ReleaseBindingService,
  ResourceNode,
} from '../services/releaseBindingService';
import type { ResourceNodeData, ResourceNodeType } from './types';
import { toTreeItem } from './shared';
import { stringify } from 'yaml';

type Client = NonNullable<
  Awaited<ReturnType<ApiClientManager['getClient']>>
>;

export class ResourceExplorerProvider
  implements vscode.TreeDataProvider<ResourceNodeData>
{
  private onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    ResourceNodeData | undefined | void
  >();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(
    private readonly authProvider: OccConfigAuthProvider,
    private readonly apiClientManager: ApiClientManager,
    private readonly capabilityService: CapabilityService,
    private readonly workflowRunService: WorkflowRunService,
    private readonly releaseBindingService: ReleaseBindingService,
  ) {
    authProvider.onDidChangeSession(() => this.refresh());
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: ResourceNodeData): vscode.TreeItem {
    return toTreeItem(element);
  }

  async getChildren(
    element?: ResourceNodeData,
  ): Promise<ResourceNodeData[]> {
    if (!element) {
      return this.getRootNodes();
    }
    if (element.childrenMode === 'preloaded') {
      return element.children ?? [];
    }
    if (element.childrenMode === 'lazy') {
      return this.fetchLazyChildren(element);
    }
    return [];
  }

  private async getRootNodes(): Promise<ResourceNodeData[]> {
    const session = this.authProvider.getSession();
    if (!session) {
      return [
        {
          label: 'Not connected. Run "occ login" to authenticate.',
          type: 'no-connection',
          contextValue: 'no-connection',
          childrenMode: 'none',
        },
      ];
    }

    const contextInfo = this.authProvider.getContextInfo();
    if (!contextInfo?.namespace) {
      return [
        {
          label: 'No namespace selected. Click $(globe) to select one.',
          type: 'no-connection',
          contextValue: 'no-connection',
          childrenMode: 'none',
        },
      ];
    }

    try {
      const client = await this.apiClientManager.getClient();
      if (!client) {
        return [
          {
            label: 'Session expired. Run "occ login" to re-authenticate.',
            type: 'no-connection',
            contextValue: 'no-connection',
            childrenMode: 'none',
          },
        ];
      }

      const ns = contextInfo.namespace;

      // Ensure RBAC capabilities are loaded for this namespace
      await this.capabilityService.ensureLoaded(ns);

      const { data, error } = await client.GET(
        '/api/v1/namespaces/{namespaceName}/projects',
        { params: { path: { namespaceName: ns } } },
      );

      if (error) {
        throw new Error('Failed to fetch projects');
      }

      const projectItems = data?.items ?? [];
      if (projectItems.length === 0) {
        return [
          {
            label: 'No projects',
            type: 'empty',
            contextValue: 'empty',
            childrenMode: 'none',
          },
        ];
      }

      return projectItems.map((p) => {
        const isDeleting = !!(p as { metadata?: { deletionTimestamp?: string } }).metadata?.deletionTimestamp;
        return {
          label: (p.metadata?.name as string),
          type: 'project' as const,
          contextValue: isDeleting ? 'project' : this.resolveContextValue('project'),
          description: isDeleting ? '(deleting)' : undefined,
          namespace: ns,
          project: p.metadata?.name as string,
          resourceName: p.metadata?.name as string,
          childrenMode: 'lazy' as const,
          lazyChildrenKey: 'project-children',
        };
      });
    } catch (error) {
      return [
        {
          label: `Error: ${error instanceof Error ? error.message : 'Failed to fetch resources'}`,
          type: 'no-connection',
          contextValue: 'no-connection',
          childrenMode: 'none',
        },
      ];
    }
  }

  private async fetchLazyChildren(
    element: ResourceNodeData,
  ): Promise<ResourceNodeData[]> {
    try {
      const client = await this.apiClientManager.getClient();
      if (!client) {
        return [];
      }

      switch (element.lazyChildrenKey) {
        case 'project-children':
          return this.fetchProjectChildren(client, element);
        case 'component-children':
          return this.buildComponentChildren(client, element);
        case 'workflow-runs':
          return this.fetchWorkflowRuns(client, element);
        case 'component-releases':
          return this.fetchComponentReleases(client, element);
        case 'release-bindings':
          return this.fetchReleaseBindings(client, element);
        case 'workflow-run-steps':
          return this.fetchWorkflowRunSteps(element);
        case 'k8s-resource-tree':
          return this.fetchK8sResourceTree(element);
        default:
          return [];
      }
    } catch {
      return [
        {
          label: 'Failed to load',
          type: 'empty',
          contextValue: 'empty',
          childrenMode: 'none',
        },
      ];
    }
  }

  private static readonly EDITABLE_TYPES: ReadonlySet<ResourceNodeType> =
    new Set(['project', 'component', 'deployment-pipeline', 'workload', 'release-binding']);

  /** Types that support creating child resources via inline "+" button. */
  private static readonly CREATABLE_TYPES: ReadonlySet<ResourceNodeType> =
    new Set(['project']);

  private resolveContextValue(type: ResourceNodeType): string {
    let value: string = type;
    if (ResourceExplorerProvider.EDITABLE_TYPES.has(type)) {
      value += '_editable';
    }
    if (this.capabilityService.canDelete(type)) {
      value += '_deletable';
    }
    if (ResourceExplorerProvider.CREATABLE_TYPES.has(type)) {
      value += '_creatable';
    }
    return value;
  }

  private async fetchProjectChildren(
    client: Client,
    element: ResourceNodeData,
  ): Promise<ResourceNodeData[]> {
    const ns = element.namespace!;
    const proj = element.project!;
    const children: ResourceNodeData[] = [];

    // Fetch deployment pipelines for this project
    const { data: pipelineData } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/deploymentpipelines',
      { params: { path: { namespaceName: ns }, query: { labelSelector: `openchoreo.dev/project=${proj}` } } },
    );

    const pipelines = pipelineData?.items ?? [];
    for (const pipeline of pipelines) {
      const pipelineName = pipeline.metadata?.name as string;
      const isDeleting = !!(pipeline as { metadata?: { deletionTimestamp?: string } }).metadata?.deletionTimestamp;
      children.push({
        label: pipelineName ?? 'deployment-pipeline',
        type: 'deployment-pipeline',
        contextValue: isDeleting ? 'deployment-pipeline' : this.resolveContextValue('deployment-pipeline'),
        description: isDeleting ? '(deleting)' : undefined,
        namespace: ns,
        project: proj,
        resourceName: pipelineName ?? 'deployment-pipeline',
        childrenMode: 'none',
      });
    }

    // Fetch components for this project
    const { data: componentsData } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/components',
      { params: { path: { namespaceName: ns }, query: { project: proj } } },
    );

    const componentItems = componentsData?.items ?? [];
    for (const comp of componentItems) {
      const compName = comp.metadata?.name as string;
      const isDeleting = !!(comp as { metadata?: { deletionTimestamp?: string } }).metadata?.deletionTimestamp;
      const hasWorkflow = !!(comp as { spec?: { workflow?: { name?: string } } })?.spec?.workflow?.name;
      let cv = isDeleting ? 'component' : this.resolveContextValue('component');
      if (hasWorkflow) cv += '_buildable';
      children.push({
        label: compName,
        type: 'component',
        contextValue: cv,
        description: isDeleting ? '(deleting)' : undefined,
        namespace: ns,
        project: proj,
        component: compName,
        resourceName: compName,
        childrenMode: 'lazy',
        lazyChildrenKey: 'component-children',
      });
    }

    if (children.length === 0) {
      return [
        {
          label: 'No resources',
          type: 'empty',
          contextValue: 'empty',
          childrenMode: 'none',
        },
      ];
    }

    return children;
  }

  private async buildComponentChildren(
    client: Client,
    element: ResourceNodeData,
  ): Promise<ResourceNodeData[]> {
    const base = {
      namespace: element.namespace,
      project: element.project,
      component: element.component,
    };
    const ns = element.namespace!;
    const compName = element.component!;

    // Fetch component to check if it has a CI workflow
    const { data: compData } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/components/{componentName}',
      { params: { path: { namespaceName: ns, componentName: compName } } },
    );
    const hasWorkflow = !!(compData as { spec?: { workflow?: { name?: string } } })?.spec?.workflow?.name;

    // Fetch workload for this component
    const { data: workloadData } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/workloads',
      { params: { path: { namespaceName: ns }, query: { component: compName } } },
    );
    const workloads = workloadData?.items ?? [];
    const workload = workloads[0];

    const children: ResourceNodeData[] = [];

    // 1. Workload — direct child (first, most important)
    if (workload) {
      const wlName = (workload.metadata?.name as string) ?? 'unknown';
      const isDeleting = !!(workload as { metadata?: { deletionTimestamp?: string } }).metadata?.deletionTimestamp;
      children.push({
        label: 'Workload',
        type: 'workload',
        contextValue: isDeleting ? 'workload' : this.resolveContextValue('workload'),
        description: isDeleting ? `${wlName} (deleting)` : wlName,
        ...base,
        resourceName: wlName,
        childrenMode: 'none',
      });
    } else {
      children.push({
        label: 'Workload',
        type: 'workload',
        contextValue: 'workload_placeholder',
        description: hasWorkflow ? '(pending build)' : '(not created)',
        ...base,
        childrenMode: 'none',
      });
    }

    // 2. Workflow Runs (only if component has a CI workflow)
    if (hasWorkflow) {
      children.push({
        label: 'Workflow Runs',
        type: 'component-category',
        icon: 'workflow-run',
        contextValue: 'component-category',
        ...base,
        childrenMode: 'lazy',
        lazyChildrenKey: 'workflow-runs',
      });
    }

    // 3. Releases
    children.push({
      label: 'Releases',
      type: 'component-category',
      icon: 'component-release',
      contextValue: 'component-category',
      ...base,
      childrenMode: 'lazy',
      lazyChildrenKey: 'component-releases',
    });

    // 4. Release Bindings
    children.push({
      label: 'Release Bindings',
      icon: 'release-binding',
      type: 'component-category',
      contextValue: 'component-category',
      ...base,
      childrenMode: 'lazy',
      lazyChildrenKey: 'release-bindings',
    });

    return children;
  }

  private async fetchWorkflowRuns(
    client: Client,
    element: ResourceNodeData,
  ): Promise<ResourceNodeData[]> {
    const { data, error } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/workflowruns',
      {
        params: {
          path: { namespaceName: element.namespace! },
          query: {
            labelSelector: `openchoreo.dev/project=${element.project!},openchoreo.dev/component=${element.component!}`,
          },
        },
      },
    );

    if (error) {
      return [];
    }

    const items = data?.items ?? [];
    if (items.length === 0) {
      return [{ label: 'No workflow runs', type: 'empty', contextValue: 'empty', childrenMode: 'none' }];
    }

    return items.map((item) => {
      const isDeleting = !!(item as { metadata?: { deletionTimestamp?: string } }).metadata?.deletionTimestamp;
      const phase = (item as { status?: { phase?: string } }).status?.phase;
      return {
        label: (item.metadata?.name as string) ?? 'unknown',
        type: 'workflow-run' as const,
        contextValue: 'workflow-run',
        description: isDeleting ? (phase ? `(deleting) ${phase}` : '(deleting)') : phase,
        statusPhase: phase,
        namespace: element.namespace,
        project: element.project,
        component: element.component,
        resourceName: item.metadata?.name as string,
        childrenMode: 'lazy' as const,
        lazyChildrenKey: 'workflow-run-steps',
      };
    });
  }

  private async fetchComponentReleases(
    client: Client,
    element: ResourceNodeData,
  ): Promise<ResourceNodeData[]> {
    const { data, error } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/componentreleases',
      {
        params: {
          path: { namespaceName: element.namespace! },
          query: {
            component: element.component!,
          },
        },
      },
    );

    if (error) {
      return [];
    }

    const items = data?.items ?? [];
    if (items.length === 0) {
      return [{ label: 'No releases', type: 'empty', contextValue: 'empty', childrenMode: 'none' }];
    }

    return items.map((item) => {
      const isDeleting = !!(item as { metadata?: { deletionTimestamp?: string } }).metadata?.deletionTimestamp;
      return {
        label: (item.metadata?.name as string) ?? 'unknown',
        type: 'component-release' as const,
        contextValue: 'component-release',
        description: isDeleting ? '(deleting)' : undefined,
        namespace: element.namespace,
        project: element.project,
        component: element.component,
        resourceName: item.metadata?.name as string,
        childrenMode: 'none' as const,
      };
    });
  }

  private async fetchReleaseBindings(
    client: Client,
    element: ResourceNodeData,
  ): Promise<ResourceNodeData[]> {
    const ns = element.namespace!;
    const project = element.project!;
    const component = element.component!;

    // Fetch bindings, project, and pipeline in parallel
    const [bindingsRes, projectRes] = await Promise.all([
      client.GET('/api/v1/namespaces/{namespaceName}/releasebindings', {
        params: { path: { namespaceName: ns }, query: { component } },
      }),
      client.GET('/api/v1/namespaces/{namespaceName}/projects/{projectName}', {
        params: { path: { namespaceName: ns, projectName: project } },
      }),
    ]);

    const bindings = bindingsRes.data?.items ?? [];
    const pipelineName = (projectRes.data as { spec?: { deploymentPipelineRef?: { name?: string } } })
      ?.spec?.deploymentPipelineRef?.name;

    // Get pipeline environments in topological order
    let envOrder: string[] = [];
    let promotionTargets: Record<string, string[]> = {};
    if (pipelineName) {
      const pipelineRes = await client.GET(
        '/api/v1/namespaces/{namespaceName}/deploymentpipelines/{deploymentPipelineName}',
        { params: { path: { namespaceName: ns, deploymentPipelineName: pipelineName } } },
      );
      const paths = (pipelineRes.data as { spec?: { promotionPaths?: Array<{ sourceEnvironmentRef: { name: string }; targetEnvironmentRefs: Array<{ name: string }> }> } })
        ?.spec?.promotionPaths ?? [];

      // Build adjacency list and compute topological order
      const targets = new Set<string>();
      for (const p of paths) {
        const tNames = p.targetEnvironmentRefs.map(t => t.name);
        promotionTargets[p.sourceEnvironmentRef.name] = tNames;
        for (const t of tNames) targets.add(t);
      }
      // Kahn's algorithm
      const sources = new Set(paths.map(p => p.sourceEnvironmentRef.name));
      const allEnvs = new Set([...sources, ...targets]);
      const inDegree: Record<string, number> = {};
      for (const e of allEnvs) inDegree[e] = 0;
      for (const p of paths) {
        for (const t of p.targetEnvironmentRefs) inDegree[t.name] = (inDegree[t.name] ?? 0) + 1;
      }
      const queue = [...allEnvs].filter(e => inDegree[e] === 0);
      while (queue.length > 0) {
        const env = queue.shift()!;
        envOrder.push(env);
        for (const t of (promotionTargets[env] ?? [])) {
          inDegree[t]--;
          if (inDegree[t] === 0) queue.push(t);
        }
      }
    }

    // Build a map of environment → binding
    const bindingByEnv: Record<string, typeof bindings[0]> = {};
    for (const b of bindings) {
      const env = (b as { spec?: { environment?: string } }).spec?.environment;
      if (env) bindingByEnv[env] = b;
    }

    // If no pipeline, fall back to showing only existing bindings
    if (envOrder.length === 0) {
      if (bindings.length === 0) {
        return [{ label: 'No release bindings', type: 'empty', contextValue: 'empty', childrenMode: 'none' }];
      }
      return bindings.map((item) => {
        const isDeleting = !!(item as { metadata?: { deletionTimestamp?: string } }).metadata?.deletionTimestamp;
        return {
          label: (item.metadata?.name as string) ?? 'unknown',
          type: 'release-binding' as const,
          contextValue: isDeleting ? 'release-binding' : this.resolveContextValue('release-binding'),
          description: isDeleting ? '(deleting)' : undefined,
          namespace: ns,
          project,
          component,
          resourceName: item.metadata?.name as string,
          childrenMode: 'lazy' as const,
          lazyChildrenKey: 'k8s-resource-tree',
        };
      });
    }

    // Merge pipeline environments with bindings
    const nodes: ResourceNodeData[] = [];
    for (const env of envOrder) {
      const binding = bindingByEnv[env];
      if (binding) {
        const isDeleting = !!(binding as { metadata?: { deletionTimestamp?: string } }).metadata?.deletionTimestamp;
        const releaseName = (binding as { spec?: { releaseName?: string } }).spec?.releaseName;
        const targets = promotionTargets[env] ?? [];
        nodes.push({
          label: env,
          type: 'release-binding',
          contextValue: isDeleting ? 'release-binding' : this.resolveContextValue('release-binding') + '_promotable',
          description: isDeleting ? '(deleting)' : releaseName ?? undefined,
          namespace: ns,
          project,
          component,
          resourceName: (binding.metadata?.name as string) ?? 'unknown',
          extra: {
            environment: env,
            releaseName: releaseName ?? '',
            ...(targets.length > 0 ? { promotionTargets: targets.join(',') } : {}),
          },
          childrenMode: 'lazy' as const,
          lazyChildrenKey: 'k8s-resource-tree',
        });
      } else {
        // Inactive environment — no binding yet
        nodes.push({
          label: env,
          type: 'release-binding-placeholder',
          contextValue: 'release-binding-placeholder_deployable',
          description: '(not deployed)',
          namespace: ns,
          project,
          component,
          extra: { environment: env },
          childrenMode: 'none',
        });
      }
    }

    // Add any bindings for environments not in the pipeline (edge case)
    for (const b of bindings) {
      const env = (b as { spec?: { environment?: string } }).spec?.environment;
      if (env && !envOrder.includes(env)) {
        const isDeleting = !!(b as { metadata?: { deletionTimestamp?: string } }).metadata?.deletionTimestamp;
        nodes.push({
          label: (b.metadata?.name as string) ?? 'unknown',
          type: 'release-binding',
          contextValue: isDeleting ? 'release-binding' : this.resolveContextValue('release-binding'),
          description: isDeleting ? '(deleting)' : undefined,
          namespace: ns,
          project,
          component,
          resourceName: (b.metadata?.name as string) ?? 'unknown',
          childrenMode: 'lazy' as const,
          lazyChildrenKey: 'k8s-resource-tree',
        });
      }
    }

    return nodes;
  }

  private async fetchWorkflowRunSteps(
    element: ResourceNodeData,
  ): Promise<ResourceNodeData[]> {
    const status = await this.workflowRunService.getStatus(
      element.namespace!,
      element.resourceName!,
    );

    if (!status?.steps?.length) {
      return [
        { label: 'No steps available', type: 'empty', contextValue: 'empty', childrenMode: 'none' },
      ];
    }

    return status.steps.map((step) => {
      let desc = step.phase;
      if (step.startedAt && step.finishedAt) {
        const dur = new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime();
        const secs = Math.round(dur / 1000);
        desc = secs >= 60 ? `${step.phase} (${Math.floor(secs / 60)}m${secs % 60}s)` : `${step.phase} (${secs}s)`;
      }
      return {
        label: step.name,
        type: 'workflow-run-step' as const,
        contextValue: 'workflow-run-step',
        description: desc,
        statusPhase: step.phase,
        namespace: element.namespace,
        project: element.project,
        component: element.component,
        resourceName: element.resourceName,
        extra: { taskName: step.name },
        childrenMode: 'none' as const,
      };
    });
  }

  private async fetchK8sResourceTree(
    element: ResourceNodeData,
  ): Promise<ResourceNodeData[]> {
    const tree = await this.releaseBindingService.getK8sResourceTree(
      element.namespace!,
      element.resourceName!,
    );

    if (!tree?.renderedReleases?.length) {
      return [
        { label: 'No deployed resources', type: 'empty', contextValue: 'empty', childrenMode: 'none' },
      ];
    }

    const results: ResourceNodeData[] = [];
    for (const release of tree.renderedReleases) {
      const k8sNodes = this.buildK8sTree(
        release.nodes,
        element.resourceName!,
        element.namespace!,
      );
      if (tree.renderedReleases.length === 1) {
        // Single release — flatten (no grouping node)
        results.push(...k8sNodes);
      } else {
        results.push({
          label: `${release.name} (${release.targetPlane})`,
          type: 'k8s-rendered-release',
          contextValue: 'k8s-rendered-release',
          namespace: element.namespace,
          childrenMode: 'preloaded',
          children: k8sNodes,
        });
      }
    }

    return results.length > 0
      ? results
      : [{ label: 'No deployed resources', type: 'empty', contextValue: 'empty', childrenMode: 'none' }];
  }

  private buildK8sTree(
    nodes: ResourceNode[],
    rbName: string,
    ns: string,
  ): ResourceNodeData[] {
    const byUid = new Map<string, ResourceNode>();
    for (const n of nodes) byUid.set(n.uid, n);

    const childMap = new Map<string, ResourceNode[]>();
    const rootNodes: ResourceNode[] = [];

    for (const n of nodes) {
      const parentInTree = n.parentRefs?.find((pr) => byUid.has(pr.uid));
      if (parentInTree) {
        const children = childMap.get(parentInTree.uid) ?? [];
        children.push(n);
        childMap.set(parentInTree.uid, children);
      } else {
        rootNodes.push(n);
      }
    }

    const toNodeData = (n: ResourceNode): ResourceNodeData => {
      const children = childMap.get(n.uid) ?? [];
      const isPod = n.kind === 'Pod';
      const healthDesc = n.health?.status;
      return {
        label: n.kind,
        type: isPod ? 'k8s-pod' : 'k8s-resource',
        contextValue: isPod ? 'k8s-pod' : 'k8s-resource',
        description: healthDesc ? `${n.name}  ${healthDesc}` : n.name,
        healthStatus: n.health?.status,
        namespace: ns,
        resourceName: n.name,
        extra: {
          group: n.group ?? '',
          version: n.version,
          kind: n.kind,
          releaseBindingName: rbName,
          objectYaml: stringify(n.object),
        },
        childrenMode: children.length > 0 ? 'preloaded' : 'none',
        children: children.map(toNodeData),
      };
    };

    return rootNodes.map(toNodeData);
  }
}

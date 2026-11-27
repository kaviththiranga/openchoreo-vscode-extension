// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { api, occContext } from '../../cluster';
import { PIPELINE } from './data';

/** Off-camera resets for repeatable delivery scenes, through the OpenChoreo API with the demo login. */

interface Item {
  metadata?: { name?: string; creationTimestamp?: string; labels?: Record<string, string>; annotations?: Record<string, string> };
  spec?: { environment?: string; releaseName?: string; owner?: { componentName?: string } };
  status?: { conditions?: { type?: string; status?: string }[] };
}

const ns = () => occContext().namespace;

async function list(kind: string, query: Record<string, string>): Promise<Item[]> {
  const qs = new URLSearchParams(query).toString();
  const res = await api('GET', `/api/v1/namespaces/${ns()}/${kind}${qs ? `?${qs}` : ''}`);
  if (res.status !== 200) throw new Error(`GET ${kind}: ${res.status} ${JSON.stringify(res.json)}`);
  return ((res.json as { items?: Item[] }).items ?? []).sort((a, b) =>
    (a.metadata?.creationTimestamp ?? '').localeCompare(b.metadata?.creationTimestamp ?? ''));
}

/** A component's workflow runs, oldest first. */
export function workflowRuns(project: string, component: string): Promise<Item[]> {
  return list('workflowruns', { labelSelector: `openchoreo.dev/project=${project},openchoreo.dev/component=${component}` });
}

/** A component's releases, oldest first. */
export function releases(component: string): Promise<Item[]> {
  return list('componentreleases', { component });
}

export async function binding(component: string, environment: string): Promise<Item | undefined> {
  return (await list('releasebindings', { component })).find((b) => b.spec?.environment === environment);
}

/** Whether a workflow run has finished (1.4 reports it in conditions, not a phase). */
export function completed(run: Item): boolean {
  return !!run.status?.conditions?.some((c) => c.type === 'WorkflowCompleted' && c.status === 'True');
}

/** Whether a workflow run failed. */
export function failed(run: Item): boolean {
  return !!run.status?.conditions?.some((c) => c.type === 'WorkflowFailed' && c.status === 'True');
}

export interface RunStatus {
  status?: string;
  steps?: { name: string; phase: string; startedAt?: string; finishedAt?: string }[];
}

export async function runStatus(run: string): Promise<RunStatus> {
  return (await api('GET', `/api/v1/namespaces/${ns()}/workflowruns/${run}/status`)).json as RunStatus;
}

export async function runLogLines(run: string, task: string): Promise<number> {
  const json = (await api('GET', `/api/v1/namespaces/${ns()}/workflowruns/${run}/logs?task=${task}`)).json;
  return Array.isArray(json) ? json.length : 0;
}

/** Start a component's build the way Trigger Build does (a WorkflowRun from the component's workflow). */
export async function startBuild(project: string, component: string): Promise<string> {
  const comp = (await api('GET', `/api/v1/namespaces/${ns()}/components/${component}`)).json as {
    spec?: { workflow?: { kind?: string; name?: string; parameters?: unknown } };
  };
  const wf = comp.spec?.workflow;
  if (!wf?.name) throw new Error(`${component} has no workflow`);
  const name = `${component}-${Date.now().toString(36)}`;
  const res = await api('POST', `/api/v1/namespaces/${ns()}/workflowruns`, {
    metadata: { name, namespace: ns(), labels: { 'openchoreo.dev/project': project, 'openchoreo.dev/component': component } },
    spec: { workflow: { kind: wf.kind ?? 'ClusterWorkflow', name: wf.name, ...(wf.parameters ? { parameters: wf.parameters } : {}) } },
  });
  if (res.status >= 300) throw new Error(`start build: ${res.status} ${JSON.stringify(res.json)}`);
  return name;
}

/** Point a binding at a release (create it when missing) and wait until it is ready. */
async function bindRelease(project: string, component: string, environment: string, releaseName: string): Promise<void> {
  // A controller may update the binding between the read and the write: read again and retry.
  for (let attempt = 1; ; attempt++) {
    try {
      return await bindOnce(project, component, environment, releaseName);
    } catch (err) {
      if (attempt >= 4 || !/: (409|5\d\d) /.test(String(err))) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

async function bindOnce(project: string, component: string, environment: string, releaseName: string): Promise<void> {
  const existing = await binding(component, environment);
  // kubectl's last-applied annotation would fill the binding the extension opens for review.
  const applied = 'kubectl.kubernetes.io/last-applied-configuration';
  const annotated = !!existing?.metadata?.annotations?.[applied];
  if (existing?.spec?.releaseName === releaseName && !annotated) return;
  if (existing) {
    const annotations = { ...existing.metadata?.annotations };
    delete annotations[applied];
    const body = { ...existing, metadata: { ...existing.metadata, annotations }, spec: { ...existing.spec, releaseName } };
    const res = await api('PUT', `/api/v1/namespaces/${ns()}/releasebindings/${existing.metadata?.name}`, body);
    if (res.status >= 300) throw new Error(`bind ${releaseName} to ${environment}: ${res.status} ${JSON.stringify(res.json)}`);
    return;
  }
  const res = await api('POST', `/api/v1/namespaces/${ns()}/releasebindings`, {
    apiVersion: 'openchoreo.dev/v1alpha1',
    kind: 'ReleaseBinding',
    metadata: { name: `${component}-${environment}`, namespace: ns() },
    spec: { owner: { projectName: project, componentName: component }, environment, releaseName },
  });
  if (res.status >= 300) throw new Error(`bind ${releaseName} to ${environment}: ${res.status} ${JSON.stringify(res.json)}`);
}

/** The releases scenes generated (`<component>-vN`), oldest first. */
export async function generatedReleases(): Promise<string[]> {
  const pattern = new RegExp(`^${PIPELINE.component}-v(\\d+)$`);
  return (await releases(PIPELINE.component))
    .map((r) => r.metadata?.name ?? '')
    .filter((n) => pattern.test(n))
    .sort((a, b) => Number(pattern.exec(a)![1]) - Number(pattern.exec(b)![1]));
}

/** The name the next generated release gets: v3, v4… */
export async function nextReleaseName(): Promise<string> {
  const last = (await generatedReleases()).pop();
  const n = last ? Number(/(\d+)$/.exec(last)![1]) + 1 : 3;
  return `${PIPELINE.component}-v${n}`;
}

/** The newest generated release, generating v3 when there is none. */
export async function newestRelease(): Promise<string> {
  const last = (await generatedReleases()).pop();
  if (last) return last;
  const name = await nextReleaseName();
  const res = await api('POST', `/api/v1/namespaces/${ns()}/components/${PIPELINE.component}/generate-release`, { releaseName: name });
  if (res.status >= 300) throw new Error(`generate ${name}: ${res.status} ${JSON.stringify(res.json)}`);
  return name;
}

/**
 * Turn off autoDeploy: with it on, the controller points the first
 * environment back at the latest auto-generated release right after a manual
 * deploy or roll back.
 */
async function manualDeploys(component: string): Promise<void> {
  const route = `/api/v1/namespaces/${ns()}/components/${component}`;
  const comp = (await api('GET', route)).json as { spec?: { autoDeploy?: boolean } };
  if (comp.spec?.autoDeploy === false) return;
  const res = await api('PUT', route, { ...comp, spec: { ...comp.spec, autoDeploy: false } });
  if (res.status >= 300) throw new Error(`turn off autoDeploy on ${component}: ${res.status} ${JSON.stringify(res.json)}`);
}

/**
 * Set the pipeline component's bindings. OpenChoreo only binds a release to an
 * environment when the previous environment references it, so the writes go
 * development first and detour through the wanted release where needed.
 */
export async function setPipeline(want: { development: string; staging: string; production: string }): Promise<void> {
  const { project, component } = PIPELINE;
  await manualDeploys(component);
  const now = async (env: string) => (await binding(component, env))?.spec?.releaseName;
  const bind = (env: string, rel: string) => bindRelease(project, component, env, rel);
  if ((await now('production')) !== want.production) {
    await bind('development', want.production);
    await bind('staging', want.production);
    await bind('production', want.production);
  }
  if ((await now('staging')) !== want.staging) {
    await bind('development', want.staging);
    await bind('staging', want.staging);
  }
  await bind('development', want.development);
}

/** The seeded state: development and staging on v2, production on v1. */
export async function restorePipeline(): Promise<void> {
  await setPipeline({ development: PIPELINE.v2, staging: PIPELINE.v2, production: PIPELINE.v1 });
}

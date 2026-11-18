// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Go to Definition for references between OpenChoreo resources: from a
 * Component's componentType, traits or workflow, a binding's environment or
 * release, a Project's pipeline, and so on, to the file in the workspace that
 * declares the target, or to the resource on the cluster.
 */
import * as vscode from 'vscode';
import { isMap, isPair, isScalar, isSeq, parseAllDocuments, type Node as YamlNode } from 'yaml';
import { kindSpec } from '../kinds/registry';
import type { GitOpsRepoIndex } from './repoIndex';

export interface Reference {
  /** Kinds the value may name, most likely first. */
  kinds: string[];
  name: string;
}

type Path = (string | number)[];

/**
 * What a scalar at `path` in a resource of `kind` refers to. `sibling` reads
 * a key next to the value (e.g. the `kind` beside a `name`).
 */
export function referenceAt(kind: string, path: Path, value: string, sibling: (key: string) => unknown): Reference | undefined {
  const p = path.map(String).join('.').replace(/\.\d+(?=\.|$)/g, '.*');
  const typed = (namespaced: string, cluster: string, name = value): Reference => {
    const declared = sibling('kind');
    if (declared === namespaced || declared === cluster) return { kinds: [String(declared)], name };
    return { kinds: [cluster, namespaced], name };
  };
  switch (p) {
    case 'spec.componentType.name':
      // `<workloadType>/<name>`
      return typed('ComponentType', 'ClusterComponentType', value.includes('/') ? value.split('/').slice(1).join('/') : value);
    case 'spec.traits.*.name':
      return typed('Trait', 'ClusterTrait');
    case 'spec.workflow.name':
      return typed('Workflow', 'ClusterWorkflow');
    case 'spec.type.name':
      return kind === 'Project' ? typed('ProjectType', 'ClusterProjectType') : kind === 'Resource' ? typed('ResourceType', 'ClusterResourceType') : undefined;
    case 'spec.dataPlaneRef.name':
      return typed('DataPlane', 'ClusterDataPlane');
    case 'spec.workflowPlaneRef.name':
      return typed('WorkflowPlane', 'ClusterWorkflowPlane');
    case 'spec.observabilityPlaneRef.name':
      return typed('ObservabilityPlane', 'ClusterObservabilityPlane');
    case 'spec.owner.projectName':
      return { kinds: ['Project'], name: value };
    case 'spec.owner.componentName':
      return { kinds: ['Component'], name: value };
    case 'spec.environment':
    case 'spec.promotionPaths.*.sourceEnvironmentRef.name':
    case 'spec.promotionPaths.*.targetEnvironmentRefs.*.name':
      return { kinds: ['Environment'], name: value };
    case 'spec.releaseName':
      return {
        kinds: [kind === 'ProjectReleaseBinding' ? 'ProjectRelease' : kind === 'ResourceReleaseBinding' ? 'ResourceRelease' : 'ComponentRelease'],
        name: value,
      };
    case 'spec.deploymentPipelineRef.name':
      return { kinds: ['DeploymentPipeline'], name: value };
    case 'spec.secretStoreRef.name':
      return undefined;
    default:
      return undefined;
  }
}

/** The scalar at `offset` with its path from the document root, or undefined. */
export function scalarAt(
  node: YamlNode | null | undefined,
  offset: number,
  path: Path = [],
): { path: Path; value: string; range: [number, number]; parent: YamlNode | undefined } | undefined {
  if (!node) return undefined;
  if (isMap(node)) {
    for (const pair of node.items) {
      if (!isPair(pair) || !isScalar(pair.key)) continue;
      const key = String(pair.key.value);
      const hit = scalarAt(pair.value as YamlNode, offset, [...path, key]);
      if (hit) return { ...hit, parent: hit.parent ?? node };
    }
    return undefined;
  }
  if (isSeq(node)) {
    for (let i = 0; i < node.items.length; i++) {
      const hit = scalarAt(node.items[i] as YamlNode, offset, [...path, i]);
      if (hit) return hit;
    }
    return undefined;
  }
  if (isScalar(node) && node.range && offset >= node.range[0] && offset <= node.range[1] && typeof node.value === 'string') {
    return { path, value: node.value, range: [node.range[0], node.range[1]], parent: undefined };
  }
  return undefined;
}

export function registerDefinitions(
  context: vscode.ExtensionContext,
  deps: { repoIndex: GitOpsRepoIndex; namespace: () => string | undefined },
): void {
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      [{ language: 'yaml', scheme: 'file' }, { language: 'yaml', scheme: 'untitled' }, { scheme: 'openchoreo' }],
      {
        async provideDefinition(document, position) {
          const text = document.getText();
          if (!/^apiVersion:\s*["']?openchoreo\.dev\//m.test(text)) return undefined;
          const offset = document.offsetAt(position);
          const doc = parseAllDocuments(text).find((d) => {
            const r = d.contents?.range;
            return r && offset >= r[0] && offset <= r[2];
          });
          if (!doc) return undefined;
          const value = doc.toJS() as { kind?: string; metadata?: { namespace?: string } } | null;
          if (!value?.kind) return undefined;
          const hit = scalarAt(doc.contents as YamlNode, offset);
          if (!hit) return undefined;
          const parent = hit.parent;
          const sibling = (key: string) => (parent && isMap(parent) ? (parent.get(key) as unknown) : undefined);
          const ref = referenceAt(value.kind, hit.path, hit.value, sibling);
          if (!ref) return undefined;

          const namespace = value.metadata?.namespace ?? deps.namespace();
          await deps.repoIndex.whenReady();
          const origin = new vscode.Range(document.positionAt(hit.range[0]), document.positionAt(hit.range[1]));
          const inRepo = ref.kinds.flatMap((k) => deps.repoIndex.find(k, ref.name, namespace));
          if (inRepo.length) {
            return inRepo.map((e) => ({
              originSelectionRange: origin,
              targetUri: e.uri,
              targetRange: new vscode.Range(e.line, 0, e.line, 0),
            }));
          }
          // Not declared in the workspace: the resource on the cluster.
          const spec = kindSpec(ref.kinds[0]);
          if (!spec?.nodeType) return undefined;
          const uri = vscode.Uri.from({
            scheme: 'openchoreo',
            path: spec.scope === 'cluster' ? `/${spec.nodeType}/${ref.name}.yaml` : `/namespaces/${namespace ?? 'default'}/${spec.nodeType}/${ref.name}.yaml`,
            query: 'readonly',
          });
          return [{ originSelectionRange: origin, targetUri: uri, targetRange: new vscode.Range(0, 0, 0, 0) }];
        },
      },
    ),
  );
}

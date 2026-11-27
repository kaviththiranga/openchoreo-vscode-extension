// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as YAML from 'yaml';
import { WORKLOAD_TYPES, type ProjectProfile } from '../profile';

/** Where the build workflow clones the project from. */
export interface ComponentSourceLocation {
  /** Repository URL; a placeholder is written when the folder has no remote. */
  url?: string;
  branch?: string;
  /** The project folder relative to the repository root, '' at the root. */
  appPath: string;
}

export interface ComponentRenderOptions {
  namespace: string;
  projectRef: string;
  source?: ComponentSourceLocation;
}

const PLACEHOLDER_REPOSITORY = 'https://github.com/my-org/my-repo';

/**
 * Parameters of the default ClusterWorkflows: all clone `repository`, and
 * dockerfile-builder takes the Dockerfile and build context relative to the
 * repository root.
 */
function workflowParameters(profile: ProjectProfile, source: ComponentSourceLocation | undefined): Record<string, unknown> {
  const dir = source?.appPath ? `./${source.appPath}` : '.';
  const parameters: Record<string, unknown> = {
    repository: {
      url: source?.url ?? PLACEHOLDER_REPOSITORY,
      revision: { branch: source?.branch ?? 'main' },
      appPath: dir,
    },
  };
  if (profile.workflow.name === 'dockerfile-builder') {
    parameters.docker = { context: dir, filePath: `${dir}/Dockerfile` };
  }
  return parameters;
}

export function renderComponentYaml(
  profile: ProjectProfile,
  opts: ComponentRenderOptions,
): string {
  const doc = {
    apiVersion: 'openchoreo.dev/v1alpha1',
    kind: 'Component',
    metadata: {
      name: profile.projectName,
      namespace: opts.namespace,
    },
    spec: {
      owner: { projectName: opts.projectRef },
      componentType: {
        kind: 'ClusterComponentType',
        name: `${WORKLOAD_TYPES[profile.componentType]}/${profile.componentType}`,
      },
      workflow: {
        kind: 'ClusterWorkflow',
        name: profile.workflow.name,
        parameters: workflowParameters(profile, opts.source),
      },
      autoDeploy: true,
    },
  };

  return YAML.stringify(doc, { indent: 2 });
}

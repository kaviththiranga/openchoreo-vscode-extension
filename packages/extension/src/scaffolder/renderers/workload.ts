// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as YAML from 'yaml';
import type { ProjectProfile } from '../profile';

export interface WorkloadRenderOptions {
  namespace: string;
  projectRef: string;
}

export function renderWorkloadYaml(
  profile: ProjectProfile,
  opts: WorkloadRenderOptions,
): string {
  const env = profile.env ?? [];

  const container: Record<string, unknown> = {
    // Image is a placeholder — the build workflow populates the real digest
    // at release time. We still emit a value so the YAML is syntactically
    // complete and a developer can preview/edit it.
    image: `registry/${profile.projectName}:latest`,
  };
  if (env.length > 0) {
    container.env = env.map((e) => ({ key: e.key, value: e.value }));
  }

  const spec: Record<string, unknown> = {
    owner: {
      projectName: opts.projectRef,
      componentName: profile.projectName,
    },
    container,
  };

  if (profile.port !== undefined) {
    spec.endpoints = {
      http: {
        type: 'HTTP',
        port: profile.port,
      },
    };
  }

  const doc = {
    apiVersion: 'openchoreo.dev/v1alpha1',
    kind: 'Workload',
    metadata: {
      name: profile.projectName,
      namespace: opts.namespace,
    },
    spec,
  };

  return YAML.stringify(doc, { indent: 2 });
}

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as YAML from 'yaml';
import type { ProjectProfile } from '../profile';

export interface ComponentRenderOptions {
  namespace: string;
  projectRef: string;
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
      componentType: { name: profile.componentType },
      workflow: {
        name: profile.workflow.name,
        ...(Object.keys(profile.workflow.parameters).length > 0
          ? { parameters: profile.workflow.parameters }
          : {}),
      },
      autoDeploy: true,
    },
  };

  return YAML.stringify(doc, { indent: 2 });
}

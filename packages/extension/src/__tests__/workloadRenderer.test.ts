// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import * as YAML from 'yaml';
import { renderWorkloadYaml } from '../scaffolder/renderers/workload';
import type { ProjectProfile } from '../scaffolder/profile';

const profile = { projectName: 'greeter', port: 8080 } as ProjectProfile;

describe('renderWorkloadYaml', () => {
  it('emits the endpoint protocol as `type` by default (pre-1.4 servers)', () => {
    const doc = YAML.parse(renderWorkloadYaml(profile, { namespace: 'default', projectRef: 'demo' }));
    expect(doc.spec.endpoints.http).toEqual({ type: 'HTTP', port: 8080 });
    expect(doc.spec.owner).toEqual({ projectName: 'demo', componentName: 'greeter' });
  });

  it('emits `protocol` when asked (1.4+ servers)', () => {
    const doc = YAML.parse(
      renderWorkloadYaml(profile, {
        namespace: 'default',
        projectRef: 'demo',
        endpointProtocolField: 'protocol',
      }),
    );
    expect(doc.spec.endpoints.http).toEqual({ protocol: 'HTTP', port: 8080 });
  });

  it('omits endpoints when no port was detected', () => {
    const doc = YAML.parse(
      renderWorkloadYaml({ projectName: 'worker' } as ProjectProfile, {
        namespace: 'default',
        projectRef: 'demo',
      }),
    );
    expect(doc.spec.endpoints).toBeUndefined();
  });
});

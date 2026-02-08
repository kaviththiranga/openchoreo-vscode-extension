// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { detectCrdKind } from '../validation/crdDetector';

describe('detectCrdKind', () => {
  it('detects ComponentType CRD', () => {
    const yaml = `apiVersion: openchoreo.dev/v1alpha1
kind: ComponentType
metadata:
  name: service
spec:
  workloadType: deployment`;

    expect(detectCrdKind(yaml)).toBe('ComponentType');
  });

  it('detects Component CRD', () => {
    const yaml = `apiVersion: openchoreo.dev/v1alpha1
kind: Component
metadata:
  name: my-app`;

    expect(detectCrdKind(yaml)).toBe('Component');
  });

  it('detects Trait CRD', () => {
    const yaml = `apiVersion: openchoreo.dev/v1alpha1
kind: Trait
metadata:
  name: autoscaling`;

    expect(detectCrdKind(yaml)).toBe('Trait');
  });

  it('detects Workload CRD', () => {
    const yaml = `apiVersion: openchoreo.dev/v1alpha1
kind: Workload
metadata:
  name: my-workload`;

    expect(detectCrdKind(yaml)).toBe('Workload');
  });

  it('detects Environment CRD', () => {
    const yaml = `apiVersion: openchoreo.dev/v1alpha1
kind: Environment
metadata:
  name: production`;

    expect(detectCrdKind(yaml)).toBe('Environment');
  });

  it('detects all known CRD kinds', () => {
    const kinds = [
      'Organization', 'Project', 'Environment', 'DataPlane', 'BuildPlane',
      'Component', 'ComponentType', 'Trait', 'Workload', 'Workflow',
      'ComponentWorkflow', 'WorkflowRun', 'ComponentRelease', 'ReleaseBinding',
      'Release', 'DeploymentPipeline', 'Endpoint', 'API', 'APIBinding',
      'APIClass', 'SecretReference', 'ConfigurationGroup',
    ];

    for (const kind of kinds) {
      const yaml = `apiVersion: openchoreo.dev/v1alpha1\nkind: ${kind}`;
      expect(detectCrdKind(yaml)).toBe(kind);
    }
  });

  it('returns undefined for non-OpenChoreo YAML', () => {
    const yaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-deploy`;

    expect(detectCrdKind(yaml)).toBeUndefined();
  });

  it('returns undefined for unknown kind with OpenChoreo apiVersion', () => {
    const yaml = `apiVersion: openchoreo.dev/v1alpha1
kind: UnknownResource
metadata:
  name: test`;

    expect(detectCrdKind(yaml)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(detectCrdKind('')).toBeUndefined();
  });

  it('returns undefined for plain text', () => {
    expect(detectCrdKind('hello world')).toBeUndefined();
  });

  it('returns undefined when apiVersion is missing', () => {
    const yaml = `kind: Component
metadata:
  name: test`;

    expect(detectCrdKind(yaml)).toBeUndefined();
  });

  it('returns undefined when kind is missing', () => {
    const yaml = `apiVersion: openchoreo.dev/v1alpha1
metadata:
  name: test`;

    expect(detectCrdKind(yaml)).toBeUndefined();
  });
});

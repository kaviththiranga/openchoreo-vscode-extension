// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { stringify } from 'yaml';

/** Resource types whose GET endpoints return full resource definitions for editing. */
export const DEFINITION_RESOURCE_TYPES = new Set([
  'namespace',
  'component-type',
  'workflow',
  'trait',
  'project',
  'component',
  'environment',
  'data-plane',
  'workflow-plane',
  'observability-plane',
  'deployment-pipeline',
  'workload',
  'secret-reference',
  'namespace-role',
  'namespace-role-binding',
  'cluster-role',
  'cluster-role-binding',
  // Cluster-scoped resources
  'cluster-component-type',
  'cluster-workflow',
  'cluster-trait',
  'cluster-data-plane',
  'cluster-workflow-plane',
  'cluster-observability-plane',
]);

/**
 * Strips noisy Kubernetes metadata fields from a resource object,
 * leaving only the fields relevant for editing.
 */
export function cleanCrdForEditing(
  crd: Record<string, unknown>,
): Record<string, unknown> {
  const { apiVersion, kind, metadata, ...rest } = crd;
  const cleaned: Record<string, unknown> = {};

  // Ensure CRD envelope fields come first
  if (apiVersion !== undefined) cleaned.apiVersion = apiVersion;
  if (kind !== undefined) cleaned.kind = kind;

  if (metadata && typeof metadata === 'object') {
    const meta = { ...(metadata as Record<string, unknown>) };

    // Remove noisy k8s metadata fields
    delete meta.managedFields;

    // Clean annotations
    if (meta.annotations && typeof meta.annotations === 'object') {
      const annotations = {
        ...(meta.annotations as Record<string, unknown>),
      };
      delete annotations['kubectl.kubernetes.io/last-applied-configuration'];
      // Remove annotations object entirely if empty
      if (Object.keys(annotations).length === 0) {
        delete meta.annotations;
      } else {
        meta.annotations = annotations;
      }
    }

    cleaned.metadata = meta;
  }

  Object.assign(cleaned, rest);

  return cleaned;
}

/**
 * Converts a resource JSON object to a clean YAML string for editing.
 */
export function crdToYaml(crd: Record<string, unknown>): string {
  const cleaned = cleanCrdForEditing(crd);
  return stringify(cleaned, { lineWidth: 0 });
}

/**
 * Map of CRD kind names to scaffold YAML templates for the "Create New Resource" command.
 * The `{{namespace}}` placeholder is replaced with the current occ namespace at runtime.
 */
export const CRD_KIND_TO_SCAFFOLD: Record<string, string> = {
  Project: `apiVersion: openchoreo.dev/v1alpha1
kind: Project
metadata:
  name: my-project
  namespace: "{{namespace}}"
spec:
  deploymentPipelineRef:
    name: standard-pipeline
`,

  Component: `apiVersion: openchoreo.dev/v1alpha1
kind: Component
metadata:
  name: my-component
  namespace: "{{namespace}}"
spec:
  owner:
    projectName: "{{project}}"

  componentType:
    name: service

  workflow:
    name: docker
    parameters:
      dockerfile: Dockerfile

  autoDeploy: true
`,

  ComponentType: `apiVersion: openchoreo.dev/v1alpha1
kind: ComponentType
metadata:
  name: my-component-type
  namespace: "{{namespace}}"
spec:
  workloadType: deployment

  allowedWorkflows:
    - kind: Workflow
      name: docker

  parameters:
    openAPIV3Schema:
      type: object
      properties:
        replicas:
          type: integer
          default: 1

  resources:
    - id: deployment
      template:
        apiVersion: apps/v1
        kind: Deployment
        metadata:
          name: "\${metadata.name}"
        spec:
          replicas: "\${parameters.replicas}"
          selector:
            matchLabels:
              app: "\${metadata.name}"
          template:
            metadata:
              labels:
                app: "\${metadata.name}"
            spec:
              containers:
                - name: main
                  image: "\${workload.container.image}"
`,

  Trait: `apiVersion: openchoreo.dev/v1alpha1
kind: Trait
metadata:
  name: my-trait
  namespace: "{{namespace}}"
spec:
  parameters:
    openAPIV3Schema:
      type: object
      properties:
        enabled:
          type: boolean
          default: true

  creates:
    - template:
        apiVersion: v1
        kind: ConfigMap
        metadata:
          name: "\${metadata.name}-my-trait"
        data:
          config: "\${parameters.enabled}"
`,

  Environment: `apiVersion: openchoreo.dev/v1alpha1
kind: Environment
metadata:
  name: development
  namespace: "{{namespace}}"
spec:
  dataPlaneRef:
    kind: DataPlane
    name: default
  isProduction: false
`,

  DataPlane: `apiVersion: openchoreo.dev/v1alpha1
kind: DataPlane
metadata:
  name: default
  namespace: "{{namespace}}"
spec:
  planeID: prod-cluster
`,

  Workflow: `apiVersion: openchoreo.dev/v1alpha1
kind: Workflow
metadata:
  name: my-workflow
  namespace: "{{namespace}}"
spec:
  workflowPlaneRef:
    kind: WorkflowPlane
    name: default

  parameters:
    openAPIV3Schema:
      type: object
      properties:
        dockerfile:
          type: string
          default: Dockerfile

  runTemplate:
    apiVersion: argoproj.io/v1alpha1
    kind: Workflow
    metadata:
      generateName: my-workflow-
    spec:
      entrypoint: main
      templates:
        - name: main
          container:
            image: alpine:latest
            command: ["echo", "hello"]
`,

  Workload: `apiVersion: openchoreo.dev/v1alpha1
kind: Workload
metadata:
  name: my-workload
  namespace: "{{namespace}}"
spec:
  owner:
    projectName: "{{project}}"
    componentName: my-component

  container:
    image: "registry/app:latest"
    env:
      - key: PORT
        value: "8080"

  endpoints:
    http:
      type: HTTP
      port: 8080
`,

  DeploymentPipeline: `apiVersion: openchoreo.dev/v1alpha1
kind: DeploymentPipeline
metadata:
  name: standard-pipeline
  namespace: "{{namespace}}"
spec:
  promotionPaths:
    - sourceEnvironmentRef:
        name: development
      targetEnvironmentRefs:
        - name: production
`,

  WorkflowPlane: `apiVersion: openchoreo.dev/v1alpha1
kind: WorkflowPlane
metadata:
  name: default
  namespace: "{{namespace}}"
spec:
  planeID: ci-cluster
`,

  SecretReference: `apiVersion: openchoreo.dev/v1alpha1
kind: SecretReference
metadata:
  name: my-secret
  namespace: "{{namespace}}"
spec:
  template:
    type: Opaque
  data:
    - secretKey: my-key
      remoteRef:
        key: external-secret-key
  refreshInterval: 1h
`,

  ObservabilityPlane: `apiVersion: openchoreo.dev/v1alpha1
kind: ObservabilityPlane
metadata:
  name: default
  namespace: "{{namespace}}"
spec:
  planeID: shared-obs
  observerURL: http://observer.observability-plane.svc:8080
`,
};

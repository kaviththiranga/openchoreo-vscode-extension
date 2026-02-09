// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { stringify } from 'yaml';

/** Resource types whose GET endpoints return full Kubernetes CRD definitions. */
export const DEFINITION_RESOURCE_TYPES = new Set([
  'component-type',
  'workflow',
  'component-workflow',
  'trait',
  'project',
  'component',
  'environment',
  'data-plane',
  'build-plane',
  'observability-plane',
  'deployment-pipeline',
  'workload',
  'secret-reference',
  'git-secret',
  'namespace-role',
  'namespace-role-binding',
  'cluster-role',
  'cluster-role-binding',
]);

/**
 * Strips noisy Kubernetes metadata fields from a CRD object,
 * leaving only the fields relevant for editing.
 */
export function cleanCrdForEditing(
  crd: Record<string, unknown>,
): Record<string, unknown> {
  const cleaned = { ...crd };

  if (cleaned.metadata && typeof cleaned.metadata === 'object') {
    const meta = { ...(cleaned.metadata as Record<string, unknown>) };

    // Remove noisy k8s metadata fields
    delete meta.managedFields;
    delete meta.creationTimestamp;
    delete meta.generation;
    delete meta.resourceVersion;
    delete meta.uid;

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

  return cleaned;
}

/**
 * Converts a CRD JSON object to a clean YAML string for editing.
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
  deploymentPipelineRef: standard-pipeline
`,

  Component: `apiVersion: openchoreo.dev/v1alpha1
kind: Component
metadata:
  name: my-component
  namespace: "{{namespace}}"
spec:
  owner:
    projectName: default

  componentType: service

  workflow:
    name: docker
    parameters:
      dockerfile: Dockerfile
    systemParameters:
      repository:
        url: https://github.com/org/repo
        revision:
          branch: main
        appPath: "."

  parameters:
    replicas: 1

  traits: []

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
    - name: docker

  schema:
    types: {}
    parameters:
      replicas:
        type: "integer | default=1"
    envOverrides: {}

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
                  image: "\${workload.containers.main.image}"
`,

  Trait: `apiVersion: openchoreo.dev/v1alpha1
kind: Trait
metadata:
  name: my-trait
  namespace: "{{namespace}}"
spec:
  schema:
    parameters:
      enabled:
        type: "boolean | default=true"
    envOverrides: {}

  resources:
    - id: trait-resource
      includeWhen: "\${parameters.enabled}"
      template:
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
  dataPlaneRef: default
  isProduction: false
  gateway:
    dnsPrefix: api
`,

  DataPlane: `apiVersion: openchoreo.dev/v1alpha1
kind: DataPlane
metadata:
  name: default
  namespace: "{{namespace}}"
spec:
  kubernetesCluster:
    server: https://kubernetes.default.svc
    tls:
      ca:
        secretRef:
          name: cluster-ca
          key: ca.crt
    auth:
      bearerToken:
        secretRef:
          name: cluster-token
          key: token
  gateway:
    publicVirtualHost: api.example.com
    organizationVirtualHost: internal.example.com
`,

  Workload: `apiVersion: openchoreo.dev/v1alpha1
kind: Workload
metadata:
  name: my-workload
  namespace: "{{namespace}}"
spec:
  owner:
    projectName: default
    componentName: my-component

  containers:
    main:
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
  stages:
    - name: development
      environmentRef: development
    - name: production
      environmentRef: production
`,

  ComponentWorkflow: `apiVersion: openchoreo.dev/v1alpha1
kind: ComponentWorkflow
metadata:
  name: docker
  namespace: "{{namespace}}"
spec:
  systemParameters:
    repository:
      url: ""
      revision:
        branch: "main"
      appPath: "."

  schema:
    parameters:
      dockerfile:
        type: "string | default=Dockerfile"

  argoWorkflowRef:
    name: docker-build
    namespace: argo-workflows
`,
};

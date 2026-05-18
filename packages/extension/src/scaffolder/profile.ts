// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Stable contract between detectors and renderers.
 *
 * Detectors fill in as much of this as they can discover; the renderer
 * layer maps it into Component and Workload YAML.
 */

export type Language = 'node' | 'go' | 'jvm' | 'python' | 'docker' | 'ballerina' | 'unknown';

export type ComponentType = 'service' | 'web-application' | 'scheduled-task' | 'worker';

export type Confidence = 'high' | 'medium' | 'low';

/**
 * OpenChoreo ships four ClusterWorkflow builders out of the box:
 *  - dockerfile-builder         — requires a Dockerfile
 *  - paketo-buildpacks-builder  — CNB, auto-detects Node/Python/Go/JVM/.NET/etc.
 *  - gcp-buildpacks-builder     — Google CNB, similar coverage
 *  - ballerina-buildpack-builder — Ballerina-specific
 *
 * Mapped from ProjectProfile.language + presence of Dockerfile in orchestrator.
 */
export type WorkflowName =
  | 'dockerfile-builder'
  | 'paketo-buildpacks-builder'
  | 'gcp-buildpacks-builder'
  | 'ballerina-buildpack-builder';

export interface WorkflowSelection {
  name: WorkflowName;
  parameters: Record<string, unknown>;
}

export interface EnvVar {
  key: string;
  value: string;
}

export interface ProjectProfile {
  /** Derived from package.json name / go.mod module / workspace dir name. */
  projectName: string;
  language: Language;
  /** Framework slug when known: 'nextjs', 'express', 'fastapi', 'spring-boot', etc. */
  framework?: string;
  /** Human-readable framework name for display: "Next.js", "Spring Boot". */
  frameworkName?: string;
  componentType: ComponentType;
  workflow: WorkflowSelection;
  /** Container port the app listens on, if detected. */
  port?: number;
  /** Suggested start command, if detected. */
  startCommand?: string;
  /** Initial env vars (e.g. PORT). */
  env?: EnvVar[];
  confidence: Confidence;
  /** Human-readable list of evidence: "found package.json with 'next' dep", "EXPOSE 3000 in Dockerfile". */
  signals: string[];
}

/**
 * Partial output from a single detector. The orchestrator merges these
 * into a final ProjectProfile, picking the highest-precedence match.
 */
export interface DetectionResult {
  language: Language;
  framework?: string;
  frameworkName?: string;
  componentType?: ComponentType;
  port?: number;
  startCommand?: string;
  env?: EnvVar[];
  confidence: Confidence;
  signals: string[];
}

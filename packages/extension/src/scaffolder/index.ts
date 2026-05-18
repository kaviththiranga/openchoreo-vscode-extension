// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type {
  DetectionResult,
  EnvVar,
  Language,
  ProjectProfile,
  WorkflowSelection,
} from './profile';
import { createVscodeFs, type DetectorFs } from './detectors/filesystem';
import { detectDockerfile } from './detectors/dockerfile';
import { detectNode } from './detectors/node';
import { detectGo } from './detectors/go';
import { detectJvm } from './detectors/jvm';
import { detectPython } from './detectors/python';
import * as vscode from 'vscode';

export type { ProjectProfile } from './profile';
export { createVscodeFs };

/** Map language + dockerfile-presence into a workflow selection. */
function chooseWorkflow(language: Language, hasDockerfile: boolean): WorkflowSelection {
  // When the repo has a Dockerfile, honor the user's explicit choice.
  if (hasDockerfile) {
    return {
      name: 'dockerfile-builder',
      parameters: { docker: { filePath: 'Dockerfile' } },
    };
  }

  // Ballerina has its own language-specific buildpack.
  if (language === 'ballerina') {
    return { name: 'ballerina-buildpack-builder', parameters: {} };
  }

  // Everything else → Paketo CNB. It auto-detects Node/Go/JVM/Python.
  return { name: 'paketo-buildpacks-builder', parameters: {} };
}

/** Normalize a string into a DNS-1123 label for use as a Kubernetes resource name. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      // Replace non-alphanumeric with '-'
      .replace(/[^a-z0-9]+/g, '-')
      // Strip leading/trailing hyphens
      .replace(/^-+|-+$/g, '')
      // DNS-1123 label max length is 63
      .slice(0, 63) || 'my-component'
  );
}

/** Pull a component name from detector output, package.json, or the folder name. */
async function deriveProjectName(fs: DetectorFs, folderName: string): Promise<string> {
  const pkgText = await fs.readText('package.json');
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText);
      if (typeof pkg.name === 'string' && pkg.name.length > 0) {
        // Strip scope like @scope/foo → foo
        const unscoped = pkg.name.replace(/^@[^/]+\//, '');
        return slugify(unscoped);
      }
    } catch {
      // ignore
    }
  }

  const goMod = await fs.readText('go.mod');
  if (goMod) {
    const m = /^\s*module\s+(\S+)/m.exec(goMod);
    if (m) {
      const parts = m[1].split('/');
      const last = parts[parts.length - 1];
      if (last) return slugify(last);
    }
  }

  return slugify(folderName);
}

/** Merge detector-level env with downstream additions, de-duplicating by key. */
function mergeEnv(base: EnvVar[] | undefined, extra: EnvVar[] | undefined): EnvVar[] | undefined {
  if (!base && !extra) return undefined;
  const seen = new Set<string>();
  const merged: EnvVar[] = [];
  for (const entry of [...(base ?? []), ...(extra ?? [])]) {
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    merged.push(entry);
  }
  return merged.length > 0 ? merged : undefined;
}

/**
 * Run all detectors, pick the first positive match (excluding Dockerfile,
 * which is composed in separately to influence workflow selection), and
 * return a full ProjectProfile.
 */
export async function analyzeWorkspace(
  folder: vscode.WorkspaceFolder,
): Promise<ProjectProfile> {
  const fs = createVscodeFs(folder.uri);

  // Run detectors. Dockerfile is treated as a cross-cutting signal that
  // overrides workflow selection without being the "primary" language.
  const [docker, node, go, jvm, python] = await Promise.all([
    detectDockerfile(fs),
    detectNode(fs),
    detectGo(fs),
    detectJvm(fs),
    detectPython(fs),
  ]);

  const hasDockerfile = !!docker;

  // Precedence for the primary language detection:
  //  Node > Go > JVM > Python > Docker-only > unknown.
  // Rationale: a repo with `package.json` + `Dockerfile` should still
  // surface as Node (with dockerfile-builder workflow), because Node
  // framework info (port, componentType) is more specific than what
  // the Dockerfile alone tells us.
  const primary: DetectionResult | undefined = node ?? go ?? jvm ?? python ?? docker;

  const projectName = await deriveProjectName(fs, folder.name);

  if (!primary) {
    // Nothing detected — return an "unknown" profile.
    return {
      projectName,
      language: 'unknown',
      componentType: 'service',
      workflow: chooseWorkflow('unknown', hasDockerfile),
      confidence: 'low',
      signals: ['No package.json, go.mod, pom.xml, build.gradle, pyproject.toml, or Dockerfile found'],
    };
  }

  // Port: prefer Dockerfile EXPOSE if the Dockerfile explicitly declared one,
  // else the language detector's guess.
  const port = docker?.port ?? primary.port;

  // Signals: combine primary + docker evidence for transparency.
  const signals = [...primary.signals];
  if (docker && primary !== docker) signals.push(...docker.signals);

  return {
    projectName,
    language: primary.language,
    framework: primary.framework,
    frameworkName: primary.frameworkName,
    componentType: primary.componentType ?? 'service',
    workflow: chooseWorkflow(primary.language, hasDockerfile),
    port,
    startCommand: primary.startCommand,
    env: mergeEnv(
      primary.env,
      port !== undefined ? [{ key: 'PORT', value: String(port) }] : undefined,
    ),
    confidence: primary.confidence,
    signals,
  };
}

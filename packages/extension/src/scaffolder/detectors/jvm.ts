// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { XMLParser } from 'fast-xml-parser';
import type { DetectionResult, EnvVar } from '../profile';
import type { DetectorFs } from './filesystem';

interface FrameworkHint {
  match: RegExp;
  slug: string;
  name: string;
}

const FRAMEWORKS: FrameworkHint[] = [
  { match: /spring-boot-starter(-web)?/i, slug: 'spring-boot', name: 'Spring Boot' },
  { match: /io\.micronaut/i, slug: 'micronaut', name: 'Micronaut' },
  { match: /io\.quarkus/i, slug: 'quarkus', name: 'Quarkus' },
];

function detectFromText(text: string): { slug: string; name: string } | undefined {
  for (const fw of FRAMEWORKS) {
    if (fw.match.test(text)) return { slug: fw.slug, name: fw.name };
  }
  return undefined;
}

async function detectMaven(fs: DetectorFs): Promise<DetectionResult | undefined> {
  const pomText = await fs.readText('pom.xml');
  if (pomText === undefined) return undefined;

  const signals = ['Found pom.xml'];
  const env: EnvVar[] = [];

  let artifactId: string | undefined;
  let jdkVersion: string | undefined;
  try {
    const parser = new XMLParser({ ignoreAttributes: false });
    const doc = parser.parse(pomText) as { project?: Record<string, unknown> };
    const project = doc.project;
    if (project) {
      if (typeof project.artifactId === 'string') artifactId = project.artifactId;
      // maven.compiler.release / java.version / <properties><java.version>
      const props = (project.properties ?? {}) as Record<string, unknown>;
      const candidates = [
        props['maven.compiler.release'],
        props['java.version'],
        props['maven.compiler.target'],
      ].filter((v): v is string => typeof v === 'string');
      if (candidates[0]) jdkVersion = String(candidates[0]).replace(/^1\./, '');
    }
  } catch {
    signals.push('pom.xml present but could not be parsed');
  }

  if (artifactId) signals.push(`Maven artifactId: ${artifactId}`);
  if (jdkVersion) {
    signals.push(`Java version: ${jdkVersion}`);
    env.push({ key: 'BP_JVM_VERSION', value: jdkVersion });
  }

  const framework = detectFromText(pomText);
  if (framework) signals.push(`pom.xml depends on ${framework.name}`);

  return {
    language: 'jvm',
    framework: framework?.slug,
    frameworkName: framework?.name,
    componentType: 'service',
    port: 8080,
    confidence: framework ? 'high' : 'medium',
    signals,
    env: env.length > 0 ? env : undefined,
  };
}

async function detectGradle(fs: DetectorFs): Promise<DetectionResult | undefined> {
  const paths = ['build.gradle.kts', 'build.gradle'];
  let gradleText: string | undefined;
  let gradlePath: string | undefined;
  for (const p of paths) {
    const text = await fs.readText(p);
    if (text !== undefined) {
      gradleText = text;
      gradlePath = p;
      break;
    }
  }
  if (!gradleText || !gradlePath) return undefined;

  const signals = [`Found ${gradlePath}`];
  const framework = detectFromText(gradleText);
  if (framework) signals.push(`${gradlePath} depends on ${framework.name}`);

  return {
    language: 'jvm',
    framework: framework?.slug,
    frameworkName: framework?.name,
    componentType: 'service',
    port: 8080,
    confidence: framework ? 'high' : 'medium',
    signals,
  };
}

export async function detectJvm(fs: DetectorFs): Promise<DetectionResult | undefined> {
  const maven = await detectMaven(fs);
  if (maven) return maven;
  return detectGradle(fs);
}

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { DockerfileParser } from 'dockerfile-ast';
import type { DetectionResult } from '../profile';
import type { DetectorFs } from './filesystem';

/**
 * Look for a Dockerfile at repo root. If present, extract EXPOSE port as a hint.
 *
 * A Dockerfile is a strong signal — high confidence, and it overrides
 * language-based workflow selection in the orchestrator (use dockerfile-builder
 * rather than a buildpack).
 */
export async function detectDockerfile(fs: DetectorFs): Promise<DetectionResult | undefined> {
  const text = await fs.readText('Dockerfile');
  if (text === undefined) return undefined;

  const signals = ['Found Dockerfile at repo root'];
  const result: DetectionResult = {
    language: 'docker',
    confidence: 'high',
    signals,
  };

  try {
    const df = DockerfileParser.parse(text);
    for (const instr of df.getInstructions()) {
      if (instr.getKeyword() !== 'EXPOSE') continue;
      for (const arg of instr.getArguments()) {
        // EXPOSE can carry protocol suffix, e.g. "8080/tcp".
        const portStr = arg.getValue().split('/')[0];
        const port = parseInt(portStr, 10);
        if (!Number.isNaN(port) && port > 0 && port < 65536) {
          result.port = port;
          signals.push(`Dockerfile EXPOSE ${port}`);
          return result;
        }
      }
    }
  } catch {
    signals.push('Dockerfile present but could not be parsed');
  }

  return result;
}

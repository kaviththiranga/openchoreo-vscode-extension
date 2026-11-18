// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { formatValidation } from '../ai/format';
import { splitDocuments } from '../ai/tools';
import { otherAgentsGuide } from '../ai/otherAgents';

const at = (line: number, character: number, message: string, severity = 2) => ({
  range: { start: { line, character } },
  severity,
  message,
});

describe('splitDocuments', () => {
  it('splits a YAML stream and remembers where each document starts', () => {
    expect(splitDocuments('kind: A\n---\nkind: B\n---\n')).toEqual([
      { text: 'kind: A', line: 0 },
      { text: 'kind: B', line: 2 },
    ]);
  });
});

describe('formatValidation', () => {
  it('reports problems with 1-based positions in the whole file', () => {
    const report = formatValidation('app.yaml', [
      { kind: 'Component', diagnostics: [], lineOffset: 0 },
      { kind: 'Workload', diagnostics: [at(11, 4, 'Unknown field "enviroment"')], lineOffset: 9 },
    ]);
    expect(report).toBe(
      'app.yaml (Component, Workload): 1 problem.\n' +
        '- Workload line 21, column 5 [warning]: Unknown field "enviroment"',
    );
  });

  it('says when a file is clean or holds no OpenChoreo resource', () => {
    expect(formatValidation('a.yaml', [{ kind: 'Project', diagnostics: [], lineOffset: 0 }])).toBe(
      'a.yaml (Project): no problems found.',
    );
    expect(formatValidation('b.yaml', [{ kind: null, diagnostics: [], lineOffset: 0 }])).toMatch(/no OpenChoreo resource/);
  });
});

describe('otherAgentsGuide', () => {
  it('lists the servers with Claude Code commands and points at the skills', () => {
    const guide = otherAgentsGuide([{ name: 'openchoreo-cp', url: 'http://cp/mcp?toolsets=a,b' }]);
    expect(guide).toContain("claude mcp add --transport http openchoreo-cp 'http://cp/mcp?toolsets=a,b'");
    expect(guide).toContain('npx skills add openchoreo/skills');
    expect(otherAgentsGuide([])).toMatch(/Sign in with "OpenChoreo: Login" first/);
  });
});

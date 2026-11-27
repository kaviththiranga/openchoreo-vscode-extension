// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { SERVER_LABELS } from '../mcp/mcpServers';
import { TOOL_NAMES } from '../ai/tools';

const root = path.resolve(__dirname, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const toolNames: string[] = manifest.contributes.languageModelTools.map((t: { name: string }) => t.name);

describe('chat contributions', () => {
  it('agents only reference MCP servers the extension registers', () => {
    const labels: string[] = Object.values(SERVER_LABELS);
    for (const agent of manifest.contributes.chatAgents) {
      const text = fs.readFileSync(path.join(root, agent.path), 'utf8');
      const tools = /^tools:\s*\[(.*)\]/m.exec(text)?.[1] ?? '';
      const servers = [...tools.matchAll(/'([\w-]+)\/\*'/g)].map((m) => m[1]);
      expect(servers.length, agent.path).toBeGreaterThan(0);
      for (const server of servers) expect(labels, `${agent.path}: ${server}`).toContain(server);
      const ownTools = [...tools.matchAll(/'([\w.-]+)\/(openchoreo_\w+)'/g)];
      for (const [, extensionId, tool] of ownTools) {
        expect(extensionId).toBe(`${manifest.publisher}.${manifest.name}`);
        expect(toolNames).toContain(tool);
      }
    }
  });

  it('hides chat hand-offs when AI features are turned off', () => {
    const handoffs = ['openchoreo.addToChat', 'openchoreo.addYamlToChat', 'openchoreo.troubleshootWithCopilot', 'openchoreo.fixWithCopilot'];
    const menus = Object.values(manifest.contributes.menus as Record<string, Array<{ command: string; when?: string }>>).flat();
    const entries = menus.filter((m) => handoffs.includes(m.command));
    expect(entries.length).toBeGreaterThan(4);
    for (const { command, when = '' } of entries) {
      if (when === 'false') continue;
      // Every alternative of the clause must carry the check.
      for (const alternative of when.split('||')) expect(alternative, command).toContain('!config.chat.disableAIFeatures');
    }
  });

  it('declares every registered language model tool', () => {
    expect(toolNames.sort()).toEqual(Object.values(TOOL_NAMES).sort());
  });

  it('contributes every upstream skill behind the bundledSkills setting', () => {
    for (const skill of manifest.contributes.chatSkills) {
      expect(skill.path).toMatch(/^\.\/skills\/[a-z0-9-]+\/SKILL\.md$/);
      expect(skill.when).toBe('config.openchoreo.ai.bundledSkills');
    }
    expect(manifest.openchoreoSkills.ref).toMatch(/^[0-9a-f]{40}$/);
  });
});

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { registeredMcpServers } from '../mcp/mcpProvider';

/**
 * Setup notes for using the same OpenChoreo MCP servers and skills from agents
 * outside the editor (Claude Code, Copilot CLI, Codex, ...). They sign in with
 * the identity provider themselves; the editor's token is never copied out.
 */
export function otherAgentsGuide(servers: Array<{ name: string; url: string }>): string {
  const lines = ['# Use OpenChoreo with other AI agents', ''];
  if (servers.length === 0) {
    lines.push('Sign in with "OpenChoreo: Login" first, so this page can list your MCP server URLs.', '');
  } else {
    lines.push(
      'These are the OpenChoreo MCP servers this editor uses. Other agents connect to the same URLs and sign in through your identity provider.',
      '',
      '| Server | URL |',
      '|---|---|',
      ...servers.map((s) => `| \`${s.name}\` | \`${s.url}\` |`),
      '',
      '## Claude Code',
      '',
      '```sh',
      ...servers.map((s) => `claude mcp add --transport http ${s.name} '${s.url}'`),
      '```',
      '',
      'Then run `/mcp` in Claude Code and sign in. On the default local (k3d) install, add `--client-id user_mcp_client --callback-port 8075` to each command.',
      '',
    );
  }
  lines.push(
    '## Skills',
    '',
    'The skills this extension bundles also install into other agents:',
    '',
    '```sh',
    'npx skills add openchoreo/skills',
    '```',
    '',
    'The repository is also an agent plugin: <https://github.com/openchoreo/skills>.',
    '',
    '## Other agents',
    '',
    'Cursor, Codex CLI, Gemini CLI and OpenCode: see <https://openchoreo.dev/docs/ai/mcp-servers/>.',
    '',
  );
  return lines.join('\n');
}

export function registerOtherAgentsGuide(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('openchoreo.setUpOtherAgents', async () => {
      // A file rather than an untitled document, so there is nothing to save on close.
      const file = vscode.Uri.joinPath(context.globalStorageUri, 'use-with-other-agents.md');
      await vscode.workspace.fs.writeFile(file, Buffer.from(otherAgentsGuide(await registeredMcpServers()), 'utf8'));
      await vscode.commands.executeCommand('markdown.showPreview', file);
    }),
  );
}

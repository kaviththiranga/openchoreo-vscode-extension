// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Hand-offs from the editor to chat: troubleshoot a failed build or a
 * deployment from the tree, and fix OpenChoreo diagnostics from a quick fix.
 * The prompts lean on the OpenChoreo MCP servers and chat tools for the facts.
 */
import * as path from 'path';
import * as vscode from 'vscode';
import type { ResourceNodeData } from '../treeView/types';
import { log } from '../logging/logger';

export interface ChatOpenOptions {
  /** Files (any URI scheme the editor can read) to attach as context. */
  attach?: vscode.Uri[];
  /** Send right away instead of leaving the prompt in the input to edit. */
  send?: boolean;
}

export async function openChat(query: string, options: ChatOpenOptions = {}): Promise<void> {
  try {
    await vscode.commands.executeCommand('workbench.action.chat.open', {
      query,
      isPartialQuery: !options.send,
      ...(options.attach?.length ? { attachFiles: options.attach } : {}),
    });
  } catch (err) {
    log.error('Opening chat failed', err);
    vscode.window.showInformationMessage('Chat is not available in this editor.');
  }
}

/** "Component "api" in Project "shop" in Namespace "default"" style location. */
export function describeLocation(node: Pick<ResourceNodeData, 'component' | 'project' | 'namespace'>): string {
  const parts: string[] = [];
  if (node.component) parts.push(`component \`${node.component}\``);
  if (node.project) parts.push(`project \`${node.project}\``);
  if (node.namespace) parts.push(`namespace \`${node.namespace}\``);
  return parts.join(', ');
}

/** The troubleshooting prompt for a tree node, or undefined for nodes it doesn't cover. */
export function troubleshootPrompt(node: ResourceNodeData): string | undefined {
  const name = node.resourceName ?? node.label;
  const where = describeLocation(node);
  switch (node.type) {
    case 'workflow-run':
      return (
        `Why did workflow run \`${name}\` (${where}) ${node.statusPhase === 'Error' ? 'error' : 'fail'}? ` +
        'Read its status, events and logs with the OpenChoreo tools, explain the cause, and suggest a fix.'
      );
    case 'release-binding':
      return (
        `Check the deployment \`${name}\` (${where}). If it isn't healthy, find out why from its status, ` +
        'events, pod logs and any root-cause reports, explain the cause, and suggest a fix.'
      );
    default:
      return undefined;
  }
}

export function fixPrompt(uri: vscode.Uri, diagnostics: readonly vscode.Diagnostic[]): string {
  const file = uri.scheme === 'file' ? path.basename(uri.fsPath) : uri.path.split('/').pop() ?? uri.toString();
  const problems = diagnostics
    .map((d) => `line ${d.range.start.line + 1}: ${d.message}`)
    .join('; ');
  return (
    `Fix the OpenChoreo problems in ${file} (${problems}). ` +
    'Check the fields against the schema, make the smallest change that fixes each problem, ' +
    'then confirm with #openchoreoValidate.'
  );
}

export function registerChatHandoffs(
  context: vscode.ExtensionContext,
  resolveNode: (arg: unknown) => ResourceNodeData | undefined,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('openchoreo.troubleshootWithCopilot', async (arg: unknown) => {
      const node = resolveNode(arg);
      const prompt = node && troubleshootPrompt(node);
      if (prompt) await openChat(prompt);
    }),

    vscode.commands.registerCommand(
      'openchoreo.fixWithCopilot',
      async (uri: vscode.Uri, diagnostics: vscode.Diagnostic[]) => {
        await openChat(fixPrompt(uri, diagnostics), { attach: [uri], send: true });
      },
    ),

    vscode.languages.registerCodeActionsProvider(
      [{ language: 'yaml', scheme: 'file' }, { language: 'yaml', scheme: 'untitled' }, { scheme: 'openchoreo' }],
      {
        provideCodeActions(document, _range, ctx) {
          const ours = ctx.diagnostics.filter((d) => d.source === 'openchoreo');
          if (ours.length === 0) return [];
          const action = new vscode.CodeAction('Fix with Copilot', vscode.CodeActionKind.QuickFix);
          action.diagnostics = ours;
          action.command = {
            command: 'openchoreo.fixWithCopilot',
            title: 'Fix with Copilot',
            arguments: [document.uri, ours],
          };
          return [action];
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  );
}

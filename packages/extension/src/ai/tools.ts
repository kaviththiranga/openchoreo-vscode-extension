// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Language model tools for chat agents: what only the editor knows (the
 * language server's validation, the occ session, version-aware scaffolds).
 * Everything that reads or changes the platform stays with the MCP servers.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';
import type { OccConfigAuthProvider } from '../auth/authProvider';
import type { ServerInfoService } from '../services/serverInfoService';
import { CRD_KIND_TO_SCAFFOLD, scaffoldTemplate } from '../services/yamlService';
import { registeredMcpServers } from '../mcp/mcpProvider';
import { formatValidation, type ValidationResult } from './format';

export const TOOL_NAMES = {
  validate: 'openchoreo_validate_yaml',
  context: 'openchoreo_get_context',
  scaffold: 'openchoreo_scaffold_resource',
} as const;

export interface ToolDeps {
  client: () => LanguageClient | undefined;
  authProvider: OccConfigAuthProvider;
  serverInfo: ServerInfoService;
}

const text = (value: string) => new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(value)]);

export function registerLanguageModelTools(context: vscode.ExtensionContext, deps: ToolDeps): void {
  if (!vscode.lm?.registerTool) return;
  context.subscriptions.push(
    vscode.lm.registerTool<{ filePath?: string; content?: string }>(TOOL_NAMES.validate, {
      prepareInvocation: ({ input }) => ({
        invocationMessage: input.filePath
          ? `Validating ${path.basename(input.filePath)}`
          : 'Validating OpenChoreo YAML',
      }),
      async invoke({ input }) {
        const source = await readSource(input);
        const client = deps.client();
        if (!client) throw new Error('The OpenChoreo language server is not running yet. Try again shortly.');
        const documents = splitDocuments(source.text);
        const results: ValidationResult[] = [];
        for (const doc of documents) {
          const result = await client.sendRequest<Omit<ValidationResult, 'lineOffset'>>('openchoreo/validate', {
            text: doc.text,
          });
          results.push({ ...result, lineOffset: doc.line });
        }
        return text(formatValidation(source.label, results));
      },
    }),

    vscode.lm.registerTool<Record<string, never>>(TOOL_NAMES.context, {
      prepareInvocation: () => ({ invocationMessage: 'Reading the OpenChoreo session' }),
      async invoke() {
        return text(JSON.stringify(await describeContext(deps), null, 2));
      },
    }),

    vscode.lm.registerTool<{ kind: string; namespace?: string; project?: string }>(TOOL_NAMES.scaffold, {
      prepareInvocation: ({ input }) => ({ invocationMessage: `Scaffolding a ${input.kind}` }),
      async invoke({ input }) {
        const template = scaffoldTemplate(input.kind, (major, minor) => deps.serverInfo.supports(major, minor, true));
        if (!template) {
          throw new Error(
            `No scaffold for kind "${input.kind}". Known kinds: ${Object.keys(CRD_KIND_TO_SCAFFOLD).join(', ')}.`,
          );
        }
        const session = deps.authProvider.getSession();
        const yaml = template
          .replace(/\{\{namespace\}\}/g, input.namespace ?? session?.context.namespace ?? 'default')
          .replace(/\{\{project\}\}/g, input.project ?? session?.context.project ?? 'default');
        return text(
          `Scaffold for ${input.kind} on OpenChoreo ${deps.serverInfo.getVersion()?.raw ?? '(version unknown)'}. ` +
            `Replace placeholder names, then validate with ${TOOL_NAMES.validate}.\n\n\`\`\`yaml\n${yaml}\`\`\``,
        );
      },
    }),
  );
}

async function readSource(input: { filePath?: string; content?: string }): Promise<{ label: string; text: string }> {
  if (input.content?.trim()) return { label: 'the YAML provided', text: input.content };
  if (!input.filePath) throw new Error('Pass either filePath (absolute) or content.');
  const uri = path.isAbsolute(input.filePath)
    ? vscode.Uri.file(input.filePath)
    : vscode.workspace.workspaceFolders?.[0]
      ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, input.filePath)
      : vscode.Uri.file(input.filePath);
  // Prefer the editor buffer, which may have unsaved edits.
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) return { label: path.basename(uri.fsPath), text: open.getText() };
  if (!fs.existsSync(uri.fsPath)) throw new Error(`File not found: ${uri.fsPath}. Pass an absolute path.`);
  return { label: path.basename(uri.fsPath), text: fs.readFileSync(uri.fsPath, 'utf8') };
}

/** Split a multi-document YAML stream, remembering where each document starts. */
export function splitDocuments(source: string): Array<{ text: string; line: number }> {
  const lines = source.split('\n');
  const docs: Array<{ text: string; line: number }> = [];
  let start = 0;
  lines.forEach((line, i) => {
    if (/^---\s*$/.test(line)) {
      docs.push({ text: lines.slice(start, i).join('\n'), line: start });
      start = i + 1;
    }
  });
  docs.push({ text: lines.slice(start).join('\n'), line: start });
  return docs.filter((d) => d.text.trim().length > 0);
}

async function describeContext(deps: ToolDeps): Promise<Record<string, unknown>> {
  const session = deps.authProvider.getSession();
  const version = deps.serverInfo.getVersion();
  const editor = vscode.window.activeTextEditor?.document;
  const resource = editor ? activeResource(editor.getText()) : undefined;
  return {
    connected: !!session,
    ...(session
      ? {
          controlPlaneUrl: session.controlPlaneUrl,
          occContext: session.context.name,
          namespace: session.context.namespace,
          project: session.context.project || undefined,
          component: session.context.component || undefined,
          authentication: session.securityEnabled ? 'enabled' : 'disabled',
        }
      : { hint: 'Not signed in. Ask the user to run "OpenChoreo: Login" or `occ login`.' }),
    serverVersion: version?.raw,
    features: {
      projectTypes: deps.serverInfo.supports(1, 3),
      releaseLines: deps.serverInfo.supports(1, 4),
    },
    mcpServers: await registeredMcpServers(),
    activeEditor: editor
      ? { file: editor.uri.scheme === 'file' ? editor.uri.fsPath : editor.uri.toString(), ...resource }
      : undefined,
  };
}

function activeResource(source: string): { kind?: string; name?: string } | undefined {
  if (!/^apiVersion:\s*openchoreo\.dev\//m.test(source)) return undefined;
  return {
    kind: /^kind:\s*(\S+)/m.exec(source)?.[1],
    name: /^metadata:\s*\n(?:[ \t]+.*\n)*?[ \t]+name:\s*(\S+)/m.exec(source)?.[1],
  };
}

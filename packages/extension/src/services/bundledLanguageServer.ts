// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * The TypeScript language server bundled with the extension, for an occ
 * without `occ lsp`: schema validation, completions, hover and outline.
 * Definitions, CEL suggestions and rendering validation need `occ lsp`.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CloseAction, ErrorAction, LanguageClient, TransportKind, type LanguageClientOptions, type ServerOptions } from 'vscode-languageclient/node';
import { FS_SCHEME } from '../filesystem/fileSystemProvider';
import type { TextValidation } from './languageServerValidation';
import type { ManagedLanguageClient } from './occLanguageServer';

/** The packaged copy (VSIX) when present, else the monorepo sibling (F5 and tests). */
function firstExisting(...candidates: string[]): string {
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[candidates.length - 1];
}

export function createBundledLanguageClient(extensionPath: string, onClosed: () => void): ManagedLanguageClient {
  const serverModule = firstExisting(
    path.join(extensionPath, 'language-server', 'dist', 'server.js'),
    path.join(extensionPath, '..', 'language-server', 'dist', 'server.js'),
  );
  const schemasPath = firstExisting(path.join(extensionPath, 'schemas'), path.join(extensionPath, '..', '..', 'schemas'));
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc, options: { execArgv: ['--nolazy', '--inspect=6009'] } },
  };
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.yaml');
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'yaml' },
      { scheme: 'untitled', language: 'yaml' },
      { scheme: FS_SCHEME },
    ],
    initializationOptions: { schemasPath },
    synchronize: { fileEvents: watcher },
    errorHandler: {
      error: () => ({ action: ErrorAction.Shutdown }),
      closed: () => { onClosed(); return { action: CloseAction.DoNotRestart }; },
    },
  };
  const client = new LanguageClient('openchoreoLanguageServer', 'OpenChoreo Language Server', serverOptions, clientOptions);
  return {
    validate: (text) => client.sendRequest<TextValidation>('openchoreo/validate', { text }),
    start: () => client.start(),
    stop: () => client.stop(),
    dispose: async () => {
      try { await client.dispose(); }
      finally { watcher.dispose(); }
    },
    isRunning: () => client.isRunning(),
    sendNotification: (method, params) => client.sendNotification(method, params),
  };
}

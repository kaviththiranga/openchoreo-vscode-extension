// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  CompletionItem,
  Hover,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { detectCrdKind } from './validation/crdDetector';
import { validateDocument } from './validation/validator';
import { getCompletionItems } from './completion/completionProvider';
import { getHoverInfo } from './hover/hoverProvider';
import { getDocumentSymbols } from './symbols/documentSymbolProvider';
import { loadSchemas, CrdSchemaMap } from './schemas/schemaLoader';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let schemas: CrdSchemaMap;

/** Cache of resource names by kind, pushed from the extension via notification. */
let resourceNames: Record<string, string[]> = {};

connection.onInitialize((params: InitializeParams): InitializeResult => {
  const schemasPath = (params.initializationOptions as { schemasPath?: string } | undefined)?.schemasPath;
  schemas = loadSchemas(schemasPath);

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: ['.', ':', ' ', '$', '{'],
      },
      hoverProvider: true,
      documentSymbolProvider: true,
    },
  };
});

// Handle resource name updates from the extension
connection.onNotification(
  'openchoreo/updateResources',
  (params: Record<string, string[]>) => {
    resourceNames = params;
    const summary = Object.entries(params)
      .map(([k, v]) => `${k}(${v.length})`)
      .join(', ');
    connection.console.log(`[OpenChoreo] Received resource names: ${summary}`);
  },
);

/** Cache of resource schemas (parameters/environmentConfigs openAPIV3Schema) by kind and name. */
let resourceSchemas: Record<string, Record<string, { parameters?: unknown; environmentConfigs?: unknown }>> = {};

// Handle resource schema updates from the extension
connection.onNotification(
  'openchoreo/updateResourceSchemas',
  (params: Record<string, Record<string, { parameters?: unknown; environmentConfigs?: unknown }>>) => {
    resourceSchemas = params;
    const total = Object.values(params).reduce((sum, m) => sum + Object.keys(m).length, 0);
    connection.console.log(`[OpenChoreo] Received resource schemas: ${total} schemas`);
  },
);

// Validate documents on open and change
documents.onDidChangeContent((change) => {
  validateTextDocument(change.document);
});

async function validateTextDocument(
  textDocument: TextDocument,
): Promise<void> {
  const text = textDocument.getText();

  // Only validate YAML files that contain OpenChoreo CRDs
  const crdKind = detectCrdKind(text);
  if (!crdKind) {
    // Clear diagnostics for non-CRD files
    connection.sendDiagnostics({
      uri: textDocument.uri,
      diagnostics: [],
    });
    return;
  }

  const schema = schemas[crdKind];
  if (!schema) {
    // Known CRD kind but no schema yet
    return;
  }

  const diagnostics = validateDocument(text, schema, textDocument, resourceNames);
  connection.sendDiagnostics({
    uri: textDocument.uri,
    diagnostics,
  });
}

// Provide completions
connection.onCompletion((params): CompletionItem[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const text = document.getText();
  const crdKind = detectCrdKind(text);
  // Pass null schema if no CRD detected or no schema — completions can still
  // offer apiVersion/kind bootstrap and empty-doc scaffolds
  const schema = crdKind ? (schemas[crdKind] ?? null) : null;

  return getCompletionItems(document, params.position, schema, resourceNames, crdKind ?? undefined, resourceSchemas);
});

// Provide hover info
connection.onHover((params): Hover | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const text = document.getText();
  const crdKind = detectCrdKind(text);
  if (!crdKind) {
    return null;
  }

  const schema = schemas[crdKind];
  if (!schema) {
    return null;
  }

  return getHoverInfo(document, params.position, schema);
});

// Provide document symbols (outline view, breadcrumbs)
connection.onDocumentSymbol((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }
  return getDocumentSymbols(document);
});

documents.listen(connection);
connection.listen();

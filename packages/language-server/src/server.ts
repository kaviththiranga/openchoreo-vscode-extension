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
import { documentAt, isolatedDocuments } from './documents';

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
    const detail = Object.entries(params).map(([kind, m]) => {
      const names = Object.keys(m);
      return `${kind}(${names.length}): ${names.join(', ')}`;
    }).join(' | ');
    connection.console.log(`[OpenChoreo] Received resource schemas: ${total} — ${detail}`);
  },
);

/**
 * Validate YAML text that may not be open in an editor, for the extension's
 * chat tools. Returns the detected kind (null when the text is not an
 * OpenChoreo resource) and the diagnostics the editor would show.
 */
connection.onRequest('openchoreo/validate', (params: { text: string }) => {
  const document = TextDocument.create('untitled:openchoreo-validate.yaml', 'yaml', 1, params.text);
  return { kind: detectCrdKind(params.text) ?? null, diagnostics: diagnosticsFor(document) };
});

/** Diagnostics for every OpenChoreo resource in a file, one per YAML document. */
function diagnosticsFor(file: TextDocument) {
  return isolatedDocuments(file).flatMap(({ document, kind }) => {
    const schema = kind ? schemas[kind] : undefined;
    return schema ? validateDocument(document.getText(), schema, file, resourceNames) : [];
  });
}

// Validate documents on open and change
documents.onDidChangeContent((change) => {
  validateTextDocument(change.document);
});

async function validateTextDocument(
  textDocument: TextDocument,
): Promise<void> {
  // Files without OpenChoreo resources get (and clear) no diagnostics.
  connection.sendDiagnostics({
    uri: textDocument.uri,
    diagnostics: diagnosticsFor(textDocument),
  });
}

// Provide completions
connection.onCompletion((params): CompletionItem[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const { document: current, kind } = documentAt(document, document.offsetAt(params.position));
  // Pass null schema if no CRD detected or no schema — completions can still
  // offer apiVersion/kind bootstrap and empty-doc scaffolds
  const schema = kind ? (schemas[kind] ?? null) : null;

  return getCompletionItems(current, params.position, schema, resourceNames, kind, resourceSchemas);
});

// Provide hover info
connection.onHover((params): Hover | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const { document: current, kind } = documentAt(document, document.offsetAt(params.position));
  const schema = kind ? schemas[kind] : undefined;
  return schema ? getHoverInfo(current, params.position, schema) : null;
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

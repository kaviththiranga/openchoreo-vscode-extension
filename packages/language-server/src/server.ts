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

  const lines = text.split('\n');
  const currentLine = lines[params.position.line] ?? '';

  const { isInsideCelExpression, getCelCompletionItems: getCel } = require('./completion/celCompletions');
  const isCel = isInsideCelExpression(currentLine, params.position.character);
  if (isCel) {
    // Debug: manually trace the prefix
    const before = currentLine.substring(0, params.position.character);
    let celStart = before.length;
    for (let i = before.length - 1; i >= 0; i--) {
      if (before[i] === '{' && i > 0 && before[i - 1] === '$') { celStart = i + 1; break; }
    }
    const celPrefix = before.substring(celStart);
    const dotIdx = celPrefix.lastIndexOf('.');
    const varPath = dotIdx >= 0 ? celPrefix.substring(0, dotIdx) : '(no dot)';
    connection.console.log(`[CEL] celPrefix="${celPrefix}" dotIdx=${dotIdx} varPath="${varPath}"`);

    const celItems = getCel(currentLine, params.position.character, crdKind ?? '', params.position.line);
    connection.console.log(`[CEL] items=${celItems.length}, first=${celItems[0]?.label ?? 'none'}`);
  }

  const result = getCompletionItems(document, params.position, schema, resourceNames, crdKind ?? undefined);
  connection.console.log(`[Completion] isCel=${isCel} returned ${result.length} items`);
  return result;
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

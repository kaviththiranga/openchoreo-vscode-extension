// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import {
  DocumentSymbol,
  SymbolKind,
  Range,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  parseDocument,
  isMap,
  isSeq,
  isScalar,
  isPair,
  YAMLMap,
  YAMLSeq,
  Scalar,
  Node,
} from 'yaml';

/**
 * Extract document symbols from an OpenChoreo YAML document.
 * Provides outline view, breadcrumb navigation, and Go to Symbol.
 */
export function getDocumentSymbols(
  textDocument: TextDocument,
): DocumentSymbol[] {
  const text = textDocument.getText();

  try {
    const doc = parseDocument(text, { keepSourceTokens: true });
    if (!doc.contents || !isMap(doc.contents)) {
      return [];
    }

    return mapToSymbols(doc.contents, textDocument);
  } catch {
    return [];
  }
}

function mapToSymbols(
  node: YAMLMap,
  textDocument: TextDocument,
): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];

  for (const item of node.items) {
    if (!isPair(item) || !isScalar(item.key)) {
      continue;
    }

    const key = String(item.key.value);
    const keyRange = getRange(item.key as Scalar, textDocument);
    if (!keyRange) continue;

    // Full range must contain selectionRange — use key start to value end
    const valueRange = getNodeFullRange(item.value as Node, textDocument);
    const fullRange: Range = {
      start: keyRange.start,
      end: valueRange ? valueRange.end : keyRange.end,
    };

    if (isMap(item.value)) {
      // Object → recurse
      const children = mapToSymbols(item.value, textDocument);
      symbols.push({
        name: key,
        kind: SymbolKind.Object,
        range: fullRange,
        selectionRange: keyRange,
        children,
      });
    } else if (isSeq(item.value)) {
      // Array → show items
      const children = seqToSymbols(item.value, key, textDocument);
      symbols.push({
        name: `${key} [${item.value.items.length}]`,
        kind: SymbolKind.Array,
        range: fullRange,
        selectionRange: keyRange,
        children,
      });
    } else if (isScalar(item.value)) {
      // Scalar value
      const valueStr = String(item.value.value ?? '');
      symbols.push({
        name: key,
        detail: valueStr.length > 50 ? valueStr.substring(0, 50) + '...' : valueStr,
        kind: SymbolKind.Property,
        range: fullRange,
        selectionRange: keyRange,
      });
    }
  }

  return symbols;
}

function seqToSymbols(
  node: YAMLSeq,
  _parentKey: string,
  textDocument: TextDocument,
): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];

  node.items.forEach((item, index) => {
    if (isMap(item)) {
      // Try to find a name/label for the item
      const nameField = findNameField(item);
      const label = nameField ? `${nameField}` : `[${index}]`;

      const range = getNodeFullRange(item, textDocument);
      if (!range) return;

      const children = mapToSymbols(item, textDocument);
      symbols.push({
        name: label,
        kind: SymbolKind.Object,
        range,
        selectionRange: range,
        children,
      });
    } else if (isScalar(item)) {
      const range = getRange(item, textDocument);
      if (!range) return;

      symbols.push({
        name: String(item.value ?? `[${index}]`),
        kind: SymbolKind.Property,
        range,
        selectionRange: range,
      });
    }
  });

  return symbols;
}

/** Try to find a recognizable name for an array item (map). */
function findNameField(node: YAMLMap): string | undefined {
  for (const field of ['name', 'id', 'instanceName', 'key', 'label']) {
    for (const item of node.items) {
      if (isPair(item) && isScalar(item.key) && String(item.key.value) === field) {
        if (isScalar(item.value)) {
          return String(item.value.value);
        }
      }
    }
  }
  return undefined;
}

function getRange(scalar: Scalar, textDocument: TextDocument): Range | undefined {
  const range = scalar.range;
  if (!range || range.length < 2) return undefined;
  return {
    start: textDocument.positionAt(range[0]),
    end: textDocument.positionAt(range[1]),
  };
}

function getNodeFullRange(node: Node | null, textDocument: TextDocument): Range | undefined {
  if (!node) return undefined;
  const range = node.range;
  if (!range || range.length < 2) return undefined;
  return {
    start: textDocument.positionAt(range[0]),
    end: textDocument.positionAt(range[1]),
  };
}

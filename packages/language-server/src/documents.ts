// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Files with several YAML documents (`---` between resources, the layout of
 * the OpenChoreo samples). Each document is handled on its own, as a copy of
 * the file with everything outside it blanked: offsets, line numbers and
 * columns stay those of the file, so results need no translating.
 */
import { TextDocument } from 'vscode-languageserver-textdocument';
import { detectCrdKind, type CrdKind } from './validation/crdDetector';

/** A YAML document's span in its file: [start, end), without the `---` line. */
export interface DocumentSegment {
  start: number;
  end: number;
}

/** One YAML document of a file, isolated. */
export interface IsolatedDocument extends DocumentSegment {
  /** The file with only this document's text left in place. */
  document: TextDocument;
  kind: CrdKind | undefined;
}

const MARKER = /^---(?=\s|$)/;

export function documentSegments(text: string): DocumentSegment[] {
  const segments: DocumentSegment[] = [];
  let start = 0;
  let offset = 0;
  for (const line of text.split('\n')) {
    const next = offset + line.length + 1;
    if (MARKER.test(line)) {
      segments.push({ start, end: offset });
      start = Math.min(next, text.length);
    }
    offset = next;
  }
  segments.push({ start, end: text.length });
  return segments;
}

/** `text` with everything outside `segment` replaced by spaces, line breaks kept. */
export function isolate(text: string, segment: DocumentSegment): string {
  const blank = (s: string) => s.replace(/[^\r\n]/g, ' ');
  return blank(text.slice(0, segment.start)) + text.slice(segment.start, segment.end) + blank(text.slice(segment.end));
}

/** Every YAML document of a file; a single-document file is returned as it is. */
export function isolatedDocuments(file: TextDocument): IsolatedDocument[] {
  const text = file.getText();
  const segments = documentSegments(text);
  return segments.map((segment) => {
    const document = segments.length === 1
      ? file
      : TextDocument.create(file.uri, file.languageId, file.version, isolate(text, segment));
    return { ...segment, document, kind: detectCrdKind(document.getText()) };
  });
}

/** The YAML document an offset falls in (a `---` line belongs to the document after it). */
export function documentAt(file: TextDocument, offset: number): IsolatedDocument {
  const documents = isolatedDocuments(file);
  return documents.find((d) => offset <= d.end) ?? documents[documents.length - 1];
}

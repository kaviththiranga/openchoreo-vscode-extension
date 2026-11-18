// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as path from 'path';
import * as vscode from 'vscode';
import { getOccBinaryPath } from './cliPath';

/**
 * Puts the occ binary the extension uses on the PATH of integrated terminals,
 * so commands that agents and skills run (`occ ...`) find it even when occ
 * is only installed by the extension.
 */
export function updateTerminalPath(context: vscode.ExtensionContext): void {
  const collection = context.environmentVariableCollection;
  collection.description = 'Adds the OpenChoreo CLI (occ) to PATH';
  const enabled = vscode.workspace
    .getConfiguration('openchoreo')
    .get<boolean>('addCliToTerminalPath', true);
  const binary = getOccBinaryPath(context);
  if (!enabled || !path.isAbsolute(binary)) {
    collection.delete('PATH');
    return;
  }
  collection.prepend('PATH', `${path.dirname(binary)}${path.delimiter}`);
}

export function registerTerminalPath(context: vscode.ExtensionContext): void {
  updateTerminalPath(context);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('openchoreo.addCliToTerminalPath') || e.affectsConfiguration('openchoreo.cliPath')) {
        updateTerminalPath(context);
      }
    }),
  );
}

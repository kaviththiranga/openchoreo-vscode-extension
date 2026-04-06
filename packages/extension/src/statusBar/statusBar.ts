// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { OccConfigAuthProvider } from '../auth/authProvider';

export class StatusBarManager implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly authProvider: OccConfigAuthProvider) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.statusBarItem.command = 'openchoreo.switchContext';
    this.disposables.push(this.statusBarItem);

    // Update on session changes
    const sub = authProvider.onDidChangeSession(() => this.update());
    this.disposables.push(sub);

    this.update();
    this.statusBarItem.show();
  }

  private async update(): Promise<void> {
    const contextInfo = this.authProvider.getContextInfo();

    if (!contextInfo) {
      this.statusBarItem.text = '$(warning) OC: Not connected';
      this.statusBarItem.tooltip =
        'Not connected to OpenChoreo. Click to login.';
      this.statusBarItem.command = 'openchoreo.login';
      this.statusBarItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground',
      );
      return;
    }

    // Check if token is still valid (getToken refreshes if expired)
    const token = await this.authProvider.getToken();
    if (!token) {
      this.statusBarItem.text = '$(warning) OC: Session expired';
      this.statusBarItem.tooltip =
        'Session expired. Click to login.';
      this.statusBarItem.command = 'openchoreo.login';
      this.statusBarItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground',
      );
      return;
    }

    this.statusBarItem.command = 'openchoreo.switchContext';

    const ns = contextInfo.namespace || 'none';
    this.statusBarItem.text = `$(rocket) OC: ${contextInfo.contextName} $(symbol-namespace) ${ns}`;
    this.statusBarItem.tooltip = [
      `Context: ${contextInfo.contextName}`,
      `Namespace: ${ns}`,
      `Project: ${contextInfo.project}`,
      `API: ${contextInfo.controlPlaneUrl}`,
    ].join('\n');
    this.statusBarItem.backgroundColor = undefined;
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { OccConfigAuthProvider } from '../auth/authProvider';
import type { OccCliDetector } from '../auth/occCliDetector';
import type { LoginRunner } from '../auth/loginRunner';

export class StatusBarManager implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly authProvider: OccConfigAuthProvider,
    private readonly occCliDetector: OccCliDetector,
    private readonly loginRunner: LoginRunner,
  ) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.statusBarItem.command = 'openchoreo.switchContext';
    this.disposables.push(this.statusBarItem);

    // Update on session changes
    this.disposables.push(authProvider.onDidChangeSession(() => this.update()));
    // Update when the login runner starts/stops so the status bar shows
    // "Logging in…" alongside the sidebar.
    this.disposables.push(loginRunner.onStateChange(() => this.update()));

    this.update();
    this.statusBarItem.show();
  }

  private async update(): Promise<void> {
    // CLI missing → hard error; other states can't progress without it.
    const cliInfo = await this.occCliDetector.get();
    if (!cliInfo.installed) {
      this.statusBarItem.text = '$(error) OC: CLI missing';
      this.statusBarItem.tooltip =
        'OpenChoreo CLI (occ) not found. Click to open the install guide.';
      this.statusBarItem.command = 'openchoreo.switchContext';
      this.statusBarItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.errorBackground',
      );
      return;
    }

    // Login in progress → surface it in the status bar too.
    if (this.loginRunner.isRunning()) {
      this.statusBarItem.text = '$(sync~spin) OC: Logging in…';
      this.statusBarItem.tooltip = 'Waiting for browser-based login to complete.';
      this.statusBarItem.command = 'openchoreo.showLoginOutput';
      this.statusBarItem.backgroundColor = undefined;
      return;
    }

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
    this.statusBarItem.text = `$(openchoreo-logo) ${contextInfo.contextName} $(openchoreo-apartment) ${ns}`;
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

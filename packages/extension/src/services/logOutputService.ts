// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';

/**
 * Manages named OutputChannels for viewing logs and events.
 * Reuses channels by name to prevent proliferation.
 */
export class LogOutputService implements vscode.Disposable {
  private channels = new Map<string, vscode.OutputChannel>();

  private getOrCreate(name: string): vscode.OutputChannel {
    let ch = this.channels.get(name);
    if (!ch) {
      ch = vscode.window.createOutputChannel(name);
      this.channels.set(name, ch);
    }
    return ch;
  }

  showLogs(
    channelName: string,
    entries: Array<{ timestamp?: string; log: string }>,
  ): void {
    const ch = this.getOrCreate(channelName);
    ch.clear();
    for (const entry of entries) {
      const prefix = entry.timestamp ? `[${entry.timestamp}] ` : '';
      ch.appendLine(`${prefix}${entry.log}`);
    }
    ch.show(true);
  }

  showEvents(
    channelName: string,
    events: Array<{
      timestamp?: string;
      type: string;
      reason: string;
      message: string;
      count?: number;
      source?: string;
    }>,
  ): void {
    const ch = this.getOrCreate(channelName);
    ch.clear();
    for (const ev of events) {
      const ts = ev.timestamp ? `[${ev.timestamp}] ` : '';
      const cnt = ev.count && ev.count > 1 ? ` (x${ev.count})` : '';
      ch.appendLine(`${ts}${ev.type} ${ev.reason}${cnt}: ${ev.message}`);
    }
    ch.show(true);
  }

  dispose(): void {
    for (const ch of this.channels.values()) {
      ch.dispose();
    }
    this.channels.clear();
  }
}

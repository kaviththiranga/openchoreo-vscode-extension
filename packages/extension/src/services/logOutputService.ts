// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { log } from '../logging/logger';

/** A line entry returned by a fetch function. */
export interface LogEntry {
  timestamp?: string;
  log: string;
}

/** Format a log entry as a single line. */
function formatLogLine(entry: LogEntry): string {
  const prefix = entry.timestamp ? `[${entry.timestamp}] ` : '';
  return `${prefix}${entry.log}`;
}

/** Format an event as a single line. */
function formatEventLine(ev: {
  timestamp?: string;
  type: string;
  reason: string;
  message: string;
  count?: number;
}): string {
  const ts = ev.timestamp ? `[${ev.timestamp}] ` : '';
  const cnt = ev.count && ev.count > 1 ? ` (x${ev.count})` : '';
  return `${ts}${ev.type} ${ev.reason}${cnt}: ${ev.message}`;
}

/**
 * Manages named OutputChannels for viewing logs and events.
 * Supports one-shot display and polling-based streaming.
 */
export class LogOutputService implements vscode.Disposable {
  private channels = new Map<string, vscode.OutputChannel>();
  private activeStreams = new Map<string, NodeJS.Timeout>();
  /** Track line count per channel to append only new entries. */
  private lineCount = new Map<string, number>();

  private getOrCreate(name: string): vscode.OutputChannel {
    let ch = this.channels.get(name);
    if (!ch) {
      ch = vscode.window.createOutputChannel(name);
      this.channels.set(name, ch);
    }
    return ch;
  }

  /** One-shot: clear channel and write all entries. */
  showLogs(channelName: string, entries: LogEntry[]): void {
    const ch = this.getOrCreate(channelName);
    ch.clear();
    for (const entry of entries) {
      ch.appendLine(formatLogLine(entry));
    }
    ch.show(true);
  }

  /** One-shot: clear channel and write all events. */
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
      ch.appendLine(formatEventLine(ev));
    }
    ch.show(true);
  }

  /**
   * Start polling a fetch function and appending new lines to the channel.
   * Stops any existing stream on the same channel.
   */
  startStreaming(
    channelName: string,
    fetchFn: () => Promise<string[]>,
    intervalMs = 3000,
  ): void {
    // Stop any existing stream on this channel
    this.stopStreaming(channelName);

    const ch = this.getOrCreate(channelName);
    ch.clear();
    ch.show(true);
    this.lineCount.set(channelName, 0);

    // Initial fetch
    const poll = async () => {
      try {
        const lines = await fetchFn();
        const prev = this.lineCount.get(channelName) ?? 0;
        if (lines.length > prev) {
          for (let i = prev; i < lines.length; i++) {
            ch.appendLine(lines[i]);
          }
          this.lineCount.set(channelName, lines.length);
        }
      } catch (err) {
        log.debug(`Stream polling error for ${channelName}: ${err}`);
      }
    };

    // Run immediately, then on interval
    poll();
    const timer = setInterval(poll, intervalMs);
    this.activeStreams.set(channelName, timer);
  }

  /** Stop polling for a specific channel. */
  stopStreaming(channelName: string): void {
    const timer = this.activeStreams.get(channelName);
    if (timer) {
      clearInterval(timer);
      this.activeStreams.delete(channelName);
      this.lineCount.delete(channelName);
    }
  }

  dispose(): void {
    for (const timer of this.activeStreams.values()) {
      clearInterval(timer);
    }
    this.activeStreams.clear();
    this.lineCount.clear();
    for (const ch of this.channels.values()) {
      ch.dispose();
    }
    this.channels.clear();
  }
}

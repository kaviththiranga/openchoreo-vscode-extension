// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';

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
   * Distinguishes three outcomes per poll:
   *   - Success with new lines → append them, reset counters
   *   - Success with empty result → on first occurrence show `emptyMessage`;
   *     after MAX_EMPTY consecutive empties, stop the stream
   *   - Error → after MAX_ERROR consecutive errors, stop the stream
   * Stops any existing stream on the same channel.
   */
  startStreaming(
    channelName: string,
    fetchFn: () => Promise<string[]>,
    options: { emptyMessage?: string; intervalMs?: number } = {},
  ): void {
    const { emptyMessage = 'No data yet.', intervalMs = 3000 } = options;

    // Stop any existing stream on this channel
    this.stopStreaming(channelName);

    const ch = this.getOrCreate(channelName);
    ch.clear();
    ch.show(true);
    this.lineCount.set(channelName, 0);

    let emptyPolls = 0;
    let errorPolls = 0;
    let emptyPlaceholderShown = false;
    const MAX_EMPTY = 10; // ~30s at 3s interval
    const MAX_ERROR = 3;  // ~9s at 3s interval

    const poll = async () => {
      try {
        const lines = await fetchFn();
        errorPolls = 0;
        const prev = this.lineCount.get(channelName) ?? 0;

        if (lines.length > prev) {
          // New data arrived. If we'd shown the empty placeholder, clear and re-render.
          if (emptyPlaceholderShown) {
            ch.clear();
            emptyPlaceholderShown = false;
          }
          for (let i = prev; i < lines.length; i++) {
            ch.appendLine(lines[i]);
          }
          this.lineCount.set(channelName, lines.length);
          emptyPolls = 0;
          return;
        }

        // No new data
        if (prev === 0) {
          // We've never received any data. Show the empty placeholder on the first poll.
          if (!emptyPlaceholderShown) {
            ch.appendLine(emptyMessage);
            emptyPlaceholderShown = true;
          }
        }

        emptyPolls++;
        if (emptyPolls >= MAX_EMPTY) {
          ch.appendLine('--- stream ended (no new data) ---');
          this.stopStreaming(channelName);
        }
      } catch {
        errorPolls++;
        if (errorPolls >= MAX_ERROR) {
          ch.appendLine('--- stream ended (fetch error) ---');
          this.stopStreaming(channelName);
        }
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

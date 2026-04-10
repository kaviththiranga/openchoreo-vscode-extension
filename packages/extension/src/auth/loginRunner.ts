// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import { log } from '../logging/logger';

/**
 * Manages programmatic `occ login` execution.
 *
 * `occ login` is interactive *in time* (waits for an OAuth callback) but not
 * interactive *in input* — it prints status to stdout and opens the browser
 * itself via the Go `browser.Open` call. So we can spawn it as a child
 * process, stream output to a dedicated VS Code Output Channel, and let the
 * existing `~/.openchoreo/config` file watcher (OccConfigAuthProvider) detect
 * the resulting token update. We also fire `onStateChange` so the sidebar
 * updates immediately without waiting for the 5s file-watcher poll.
 *
 * Only one login can run at a time — concurrent `start()` calls are ignored.
 */
export interface LoginRunnerState {
  running: boolean;
  /** Last non-zero exit's stderr tail (one-shot — cleared after read). */
  lastError?: string;
}

export class LoginRunner implements vscode.Disposable {
  private child: ChildProcess | undefined;
  private channel: vscode.OutputChannel;
  private lastError: string | undefined;
  private readonly onStateChangeEmitter = new vscode.EventEmitter<void>();
  /** Fired when a login starts, exits, or is cancelled. */
  readonly onStateChange = this.onStateChangeEmitter.event;

  constructor() {
    this.channel = vscode.window.createOutputChannel('OpenChoreo Login');
  }

  isRunning(): boolean {
    return this.child !== undefined;
  }

  /**
   * Consume and clear the last error. Returns undefined if no error pending.
   * This is one-shot so the sidebar doesn't get stuck in the login-failed
   * state after the user starts a retry.
   */
  consumeLastError(): string | undefined {
    const err = this.lastError;
    this.lastError = undefined;
    return err;
  }

  /**
   * Spawn `occ login`. Additional args (e.g. --context, --controlplane) may
   * be passed for the "Create New Context" flow.
   */
  start(extraArgs: string[] = []): void {
    if (this.child) {
      // Already running — surface the existing Output Channel to the user.
      this.channel.show(true);
      return;
    }

    this.lastError = undefined;
    this.channel.clear();
    this.channel.show(true);
    this.channel.appendLine(`$ occ login ${extraArgs.join(' ')}`.trimEnd());

    let child: ChildProcess;
    try {
      child = spawn('occ', ['login', ...extraArgs], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.lastError = `Failed to spawn occ: ${String(err)}`;
      this.channel.appendLine(this.lastError);
      log.error('occ login spawn failed', err);
      this.onStateChangeEmitter.fire();
      return;
    }

    this.child = child;
    this.onStateChangeEmitter.fire();

    // Ring buffer of the last ~20 stderr lines — used as lastError on failure.
    const stderrTail: string[] = [];
    const MAX_TAIL_LINES = 20;

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      this.channel.append(text);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      this.channel.append(text);
      for (const line of text.split('\n')) {
        if (!line) continue;
        stderrTail.push(line);
        if (stderrTail.length > MAX_TAIL_LINES) stderrTail.shift();
      }
    });

    child.on('error', (err) => {
      this.lastError = `occ login failed to start: ${err.message}`;
      this.channel.appendLine(this.lastError);
      log.error('occ login process error', err);
      this.child = undefined;
      this.onStateChangeEmitter.fire();
    });

    child.on('exit', (code, signal) => {
      this.child = undefined;
      if (code === 0) {
        this.channel.appendLine('\n✓ Login complete.');
        log.info('occ login succeeded');
      } else if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        // Cancelled by the user — not an error.
        this.channel.appendLine('\nLogin cancelled.');
        log.info('occ login cancelled by user');
      } else {
        const tail = stderrTail.join('\n').trim();
        this.lastError = tail || `occ login exited with code ${code ?? 'unknown'}`;
        this.channel.appendLine(`\n✗ Login failed (exit code ${code ?? 'unknown'})`);
        log.error(`occ login failed with code ${code ?? 'unknown'}`);
      }
      this.onStateChangeEmitter.fire();
    });
  }

  /**
   * Kill the running login process, if any. Does nothing if no login is
   * active.
   */
  cancel(): void {
    if (!this.child) return;
    log.info('Cancelling occ login');
    this.child.kill();
    // The 'exit' handler will fire onStateChange.
  }

  /** Reveal the Output Channel — wired to the "Open Output" link in the UI. */
  showOutput(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.cancel();
    this.onStateChangeEmitter.dispose();
    this.channel.dispose();
  }
}

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { execFile, type ChildProcess } from 'child_process';
import type { ValidationSummary } from './renderValidation';
import type { TextValidation } from './languageServerValidation';

export function checkOccLsp(binary: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(binary, ['lsp', '--help'], {
      timeout: 5000, maxBuffer: 65536, windowsHide: true,
    }, (error, stdout) => {
      if (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const reason = code === 'ENOENT' ? 'CLI not found'
          : code === 'EACCES' ? 'Permission denied'
          : error.killed ? 'CLI compatibility check timed out'
          : 'CLI compatibility check failed';
        reject(new Error(`${reason}. Configure openchoreo.cliPath to a unified occ executable supporting lsp.`));
      } else if (!/\bocc\s+lsp\b/.test(stdout) || !stdout.includes('--stdio')) {
        reject(new Error('This occ does not support occ lsp --stdio. Upgrade it or configure openchoreo.cliPath.'));
      } else {
        resolve();
      }
    });
  });
}

export interface ManagedLanguageClient {
  hasReferenceCompletions?(uri: string, position: {line: number; character: number}): Promise<boolean>;
  hasCELCompletions?(uri: string, position: {line: number; character: number}): Promise<boolean>;
  executeCommand?(command: string, args: unknown[]): Promise<ValidationSummary>;
  hasDefinition?(uri: string, position: {line: number; character: number}): Promise<boolean>;
  validate?(text: string): Promise<TextValidation>;
  start(): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
  isRunning(): boolean;
  sendNotification(method: string, params: unknown): Promise<void>;
}

/** `occ lsp` from the installed CLI, or the TypeScript server bundled with the extension. */
export type LanguageServerBackend = 'occ' | 'bundled';
export type BackendPreference = 'auto' | LanguageServerBackend;

interface Dependencies {
  resolveBinary(): string;
  checkBinary(binary: string): Promise<void>;
  createClient(binary: string, closed: () => void): ManagedLanguageClient;
  /** The bundled server, for when the installed occ has no `occ lsp`. */
  createBundledClient?(closed: () => void): ManagedLanguageClient;
  preference?(): BackendPreference;
  log?(message: string): void;
  refresh(client: ManagedLanguageClient, current: () => boolean, generation: number): Promise<void>;
  navigationContext?(): { contextId: string | null; namespace: string | null };
  report(message: string): void;
  changed?(): void;
}

/** One client, serialized process operations, and request-scoped feed generations. */
export class OccLanguageServer {
  private client: ManagedLanguageClient | undefined;
  private queue = Promise.resolve();
  private generation = 0;
  private lifecycle = 0;
  private disposed = false;
  private attempted = false;
  private stopping = false;
  private kind: LanguageServerBackend | undefined;

  constructor(private readonly deps: Dependencies) {}

  private enqueue(work: () => Promise<void>): Promise<void> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => {});
    return next;
  }

  start(): Promise<void> {
    if (this.attempted || this.disposed) return this.queue;
    this.attempted = true;
    return this.restart();
  }

  restart(): Promise<void> {
    this.deps.changed?.();
    const lifecycle = ++this.lifecycle;
    ++this.generation;
    return this.enqueue(async () => {
      if (this.disposed || lifecycle !== this.lifecycle) return;
      try {
        await this.stopClient();
        const backend = await this.selectBackend();
        if (this.disposed || lifecycle !== this.lifecycle) return;
        const closed = () => {
          if (this.disposed || this.stopping || this.client !== client) return;
          ++this.generation;
          this.deps.changed?.();
          this.deps.report('OpenChoreo language server stopped. Check OpenChoreo Language Server output. Run occ login if authentication failed, then OpenChoreo: Restart Language Server.');
        };
        const client = backend.kind === 'occ' ? this.deps.createClient(backend.binary, closed) : this.deps.createBundledClient!(closed);
        this.kind = backend.kind;
        this.client = client;
        await client.start();
        if (this.disposed || lifecycle !== this.lifecycle) {
          await this.stopClient();
          return;
        }
        // Slow cluster requests must not block logout or shutdown.
        void this.refresh();
      } catch (error) {
        await this.stopClient().catch(() => {});
        // Use only our fixed probe messages; never copy CLI stderr/credentials.
        const message = error instanceof Error ? error.message : '';
        const probeError = /^(CLI |Permission denied|This occ)/.test(message) ? message : 'Check OpenChoreo Language Server output, verify openchoreo.cliPath, and run occ login if authentication failed.';
        this.deps.report(`OpenChoreo language server could not start. ${probeError} Then run OpenChoreo: Restart Language Server.`);
      }
    });
  }

  /** `occ lsp` when the installed occ has it, else the bundled server unless occ is required. */
  private async selectBackend(): Promise<{ kind: 'occ'; binary: string } | { kind: 'bundled' }> {
    const preference = this.deps.preference?.() ?? 'auto';
    const bundled = !!this.deps.createBundledClient;
    if (preference === 'bundled' && bundled) return { kind: 'bundled' };
    const binary = this.deps.resolveBinary();
    try {
      await this.deps.checkBinary(binary);
      return { kind: 'occ', binary };
    } catch (error) {
      if (preference === 'occ' || !bundled) throw error;
      this.deps.log?.(`Using the bundled language server: ${error instanceof Error ? error.message : error}`);
      return { kind: 'bundled' };
    }
  }

  /** Which server is running, if any. */
  backend(): LanguageServerBackend | undefined {
    return this.isRunning() ? this.kind : undefined;
  }

  async refresh(): Promise<void> {
    const generation = ++this.generation;
    this.deps.changed?.();
    const client = this.client;
    const current = () => !this.disposed && !this.stopping && generation === this.generation
      && this.client === client && !!client?.isRunning();
    if (!client || !current()) return;
    try {
      if (this.deps.navigationContext && this.kind === 'occ') {
        await client.sendNotification('openchoreo/updateResourceLocations', {
          ...this.deps.navigationContext(), generation, resources: [],
        });
        if (!current()) return;
      }
      await client.sendNotification('openchoreo/updateResources', {});
      if (!current()) return;
      await client.sendNotification('openchoreo/updateResourceSchemas', {});
      if (current()) await this.deps.refresh(client, current, generation);
      if (current()) this.deps.changed?.();
    } catch {
      if (current()) this.deps.report('Could not refresh cluster suggestions. Restart the language server to retry.');
    }
  }

  stop(): Promise<void> {
    this.deps.changed?.();
    ++this.lifecycle;
    const generation = ++this.generation;
    return this.enqueue(async () => {
      if (this.client?.isRunning()) {
        if (this.deps.navigationContext && this.kind === 'occ') await this.client.sendNotification('openchoreo/updateResourceLocations', {contextId: null, namespace: null, generation, resources: []}).catch(() => {});
        await this.client.sendNotification('openchoreo/updateResources', {}).catch(() => {});
        await this.client.sendNotification('openchoreo/updateResourceSchemas', {}).catch(() => {});
      }
      await this.stopClient();
    });
  }

  isRunning(): boolean {
    return !this.disposed && !this.stopping && !!this.client?.isRunning();
  }

  async hasReferenceCompletions(uri: string, position: {line: number; character: number}): Promise<boolean> {
    const client = this.client, lifecycle = this.lifecycle, generation = this.generation;
    if (!this.isRunning() || !client?.hasReferenceCompletions) return false;
    try {
      const found = await client.hasReferenceCompletions(uri, position);
      return found && this.isRunning() && client === this.client && lifecycle === this.lifecycle && generation === this.generation;
    } catch { return false; }
  }

  async hasCELCompletions(uri: string, position: {line: number; character: number}): Promise<boolean> {
    const client = this.client;
    const lifecycle = this.lifecycle;
    if (this.disposed || this.stopping || !client?.isRunning() || !client.hasCELCompletions) return false;
    try {
      const result = await client.hasCELCompletions(uri, position);
      return result && !this.disposed && !this.stopping && client === this.client && client.isRunning() && lifecycle === this.lifecycle;
    } catch { return false; }
  }

  async hasDefinition(uri: string, position: {line: number; character: number}): Promise<boolean> {
    const client = this.client;
    const generation = this.generation;
    if (this.disposed || this.stopping || !client?.isRunning() || !client.hasDefinition) return false;
    try {
      const found = await client.hasDefinition(uri, position);
      return found && !this.disposed && !this.stopping && this.client === client && this.generation === generation;
    } catch { return false; }
  }

  renderingSession(cluster: boolean): { generation: number; current(): boolean; execute(command: string, args: unknown[]): Promise<ValidationSummary> } | undefined {
    const client = this.client;
    const generation = this.generation, lifecycle = this.lifecycle;
    const current = () => !this.disposed && !this.stopping && this.client === client && !!client?.isRunning()
      && lifecycle === this.lifecycle && (!cluster || generation === this.generation);
    if (!current() || !client) return;
    return { generation, current, execute: async (command, args) => {
      if (!current()) throw new Error('Language server or cluster context changed. Run validation again.');
      if (!client.executeCommand) throw new Error('This occ does not support rendering validation. Upgrade occ and restart the Language Server.');
      return client.executeCommand(command, args);
    } };
  }

  async validate(text: string): Promise<TextValidation> {
    const client = this.client;
    if (this.disposed || this.stopping || !client?.isRunning() || !client.validate) {
      throw new Error('The OpenChoreo language server is not running. Run OpenChoreo: Restart Language Server.');
    }
    return client.validate(text);
  }

  private async stopClient(): Promise<void> {
    const client = this.client;
    if (!client) return;
    this.stopping = true;
    try {
      try { await client.stop(); }
      finally { await client.dispose(); }
      if (this.client === client) {
        this.client = undefined;
        this.kind = undefined;
      }
    } finally {
      this.stopping = false;
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.stop();
  }
}

/** Await exit even when the server rejects the standard LSP shutdown request. */
export async function terminateServerProcess(child: ChildProcess | undefined): Promise<void> {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const done = () => {
      clearTimeout(force);
      clearTimeout(timeout);
      child.removeListener('exit', done);
      resolve();
    };
    const force = setTimeout(() => { child.kill('SIGKILL'); }, 1000);
    const timeout = setTimeout(() => {
      child.removeListener('exit', done);
      reject(new Error('Language server process did not exit'));
    }, 4000);
    child.once('exit', done);
    child.kill();
  });
}

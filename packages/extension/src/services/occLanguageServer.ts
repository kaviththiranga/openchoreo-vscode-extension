// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { execFile, type ChildProcess } from 'child_process';
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
  validate?(text: string): Promise<TextValidation>;
  start(): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
  isRunning(): boolean;
  sendNotification(method: string, params: unknown): Promise<void>;
}

interface Dependencies {
  resolveBinary(): string;
  checkBinary(binary: string): Promise<void>;
  createClient(binary: string, closed: () => void): ManagedLanguageClient;
  refresh(client: ManagedLanguageClient, current: () => boolean): Promise<void>;
  report(message: string): void;
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
    const lifecycle = ++this.lifecycle;
    ++this.generation;
    return this.enqueue(async () => {
      if (this.disposed || lifecycle !== this.lifecycle) return;
      try {
        await this.stopClient();
        const binary = this.deps.resolveBinary();
        await this.deps.checkBinary(binary);
        if (this.disposed || lifecycle !== this.lifecycle) return;
        const client = this.deps.createClient(binary, () => {
          if (this.disposed || this.stopping || this.client !== client) return;
          ++this.generation;
          this.deps.report('OpenChoreo language server stopped. Check OpenChoreo Language Server output. Run occ login if authentication failed, then OpenChoreo: Restart Language Server.');
        });
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

  async refresh(): Promise<void> {
    const generation = ++this.generation;
    const client = this.client;
    const current = () => !this.disposed && !this.stopping && generation === this.generation
      && this.client === client && !!client?.isRunning();
    if (!client || !current()) return;
    try {
      await client.sendNotification('openchoreo/updateResources', {});
      if (!current()) return;
      await client.sendNotification('openchoreo/updateResourceSchemas', {});
      if (current()) await this.deps.refresh(client, current);
    } catch {
      if (current()) this.deps.report('Could not refresh cluster suggestions. Restart the language server to retry.');
    }
  }

  stop(): Promise<void> {
    ++this.lifecycle;
    ++this.generation;
    return this.enqueue(async () => {
      if (this.client?.isRunning()) {
        await this.client.sendNotification('openchoreo/updateResources', {}).catch(() => {});
        await this.client.sendNotification('openchoreo/updateResourceSchemas', {}).catch(() => {});
      }
      await this.stopClient();
    });
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
      if (this.client === client) this.client = undefined;
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

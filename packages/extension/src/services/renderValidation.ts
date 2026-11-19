// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0
import * as vscode from 'vscode';
import { parseAllDocuments } from 'yaml';
import { KIND_REGISTRY, collectionPathParams } from '../kinds/registry';
import { buildResourceUri } from '../filesystem/fileSystemProvider';
import { crdToYaml } from './yamlService';
import { getResourceContextId } from './resourceContext';
import type { ResourceNodeData } from '../treeView/types';
import type { ApiClientManager } from '../api/apiClient';
import type { OccConfigAuthProvider } from '../auth/authProvider';
import type { OccLanguageServer } from './occLanguageServer';

export interface ValidationSummary {
  files: number; errors: number; warnings: number;
  message?: string; details?: string[]; root?: string; validatedUris?: string[];
}
export interface ValidationDocument { uri: string; text: string; version?: number; }
export interface ClusterValidationSnapshot {
  contextId: string; namespace: string; generation: number; projectName?: string; activeUri?: string; documents: ValidationDocument[];
}
export const RENDER_VALIDATION_COMMAND = 'openchoreo.validateRendering';

export function canValidateRendering(doc: Pick<vscode.TextDocument, 'uri' | 'languageId' | 'getText'> | undefined): boolean {
  return !!doc && ['file', 'openchoreo'].includes(doc.uri.scheme) && doc.languageId === 'yaml'
    && /\bapiVersion\s*:\s*['"]?openchoreo\.dev\//.test(doc.getText());
}

export function currentValidationProject(doc: Pick<vscode.TextDocument, 'uri' | 'getText'>, selected?: { project?: string; namespace?: string }): { projectName: string; namespace: string } {
  const projects = new Set<string>();
  let namespace: string | undefined;
  for (const yaml of parseAllDocuments(doc.getText())) {
    const ns = yaml.getIn(['metadata', 'namespace']);
    if (typeof ns === 'string' && ns) namespace = ns;
    const value = yaml.get('kind') === 'Project' ? yaml.getIn(['metadata', 'name']) : yaml.getIn(['spec', 'owner', 'projectName']);
    if (typeof value === 'string' && value) projects.add(value);
  }
  const projectName = projects.size === 1 ? [...projects][0]
    : projects.size > 1 ? (selected?.project && projects.has(selected.project) ? selected.project : undefined)
    : selected?.project;
  if (!projectName) throw new Error('Select the current OpenChoreo project, or open a Project or project-owned resource YAML, before running validation.');
  return { projectName, namespace: namespace ?? (doc.uri.scheme === 'file' ? 'default' : selected?.namespace ?? 'default') };
}

/** Complete, request-scoped namespace input; partial lists are never validated. */
export async function collectNamespaceValidation(
  manager: ApiClientManager, scope: Omit<ClusterValidationSnapshot, 'documents'>,
  openDocuments: readonly vscode.TextDocument[], current: () => boolean,
): Promise<ClusterValidationSnapshot> {
  const client = await manager.getClient();
  if (!client) throw new Error('Authentication required. Run occ login, then restart the Language Server.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  const documents = new Map<string, ValidationDocument>();
  const specs = KIND_REGISTRY.filter(spec => spec.nodeType);
  let next = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(4, specs.length) }, async () => {
      while (next < specs.length) {
        if (!current()) throw new Error('Cluster resources changed. Run validation again.');
        const spec = specs[next++];
        let result;
        try {
          result = await client.GET(spec.collectionPath as never, {
            params: { path: collectionPathParams(spec, scope.namespace) }, signal: controller.signal,
          } as never);
        } catch {
          throw new Error(`Could not list ${spec.label} resources. Namespace validation was not completed; check the connection and permissions.`);
        }
        if (!current()) throw new Error('Cluster resources changed. Run validation again.');
        const items = (result.data as { items?: unknown } | undefined)?.items;
        if (result.error || !Array.isArray(items)) {
          if (result.response?.status === 401) throw new Error('Authentication failed. Run occ login, then restart the Language Server.');
          throw new Error(`Could not list ${spec.label} resources. Namespace validation was not completed; check permissions and the control-plane version.`);
        }
        for (const item of items) {
          const metadata = item?.metadata as { name?: string; namespace?: string } | undefined;
          if (!metadata?.name || spec.scope === 'namespace' && metadata.namespace && metadata.namespace !== scope.namespace) {
            throw new Error(`Invalid ${spec.label} resource in the namespace snapshot. Refresh resources and retry.`);
          }
          const namespace = spec.scope === 'namespace' ? scope.namespace : undefined;
          const uri = buildResourceUri({ type: spec.nodeType, label: metadata.name, resourceName: metadata.name, namespace } as ResourceNodeData, scope.contextId).toString();
          const crd = { ...item, apiVersion: item.apiVersion ?? 'openchoreo.dev/v1alpha1', kind: spec.kind,
            metadata: { ...metadata, ...(namespace ? { namespace } : {}) } };
          documents.set(uri, { uri, text: crdToYaml(crd) });
        }
      }
    }));
    if (!current()) throw new Error('Cluster resources changed. Run validation again.');
    for (const doc of openDocuments) {
      const uri = doc.uri.toString();
      if (documents.has(uri)) documents.set(uri, { uri, text: doc.getText(), version: doc.version });
    }
    return { ...scope, documents: [...documents.values()] };
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

/** One user-triggered validation operation, through the existing Go client. */
export class RenderingValidationController implements vscode.Disposable {
  private running = false;
  private disposed = false;
  private readonly output = vscode.window.createOutputChannel('OpenChoreo Validation');
  private readonly subscriptions: vscode.Disposable[];
  constructor(
    private readonly server: () => OccLanguageServer | undefined,
    private readonly api: ApiClientManager,
    private readonly auth: OccConfigAuthProvider,
  ) {
    const update = () => { void vscode.commands.executeCommand('setContext', 'openchoreo.canValidateRendering', canValidateRendering(vscode.window.activeTextEditor?.document)); };
    this.subscriptions = [
      vscode.commands.registerCommand(RENDER_VALIDATION_COMMAND, (uri?: vscode.Uri) => this.run(uri)),
      vscode.window.onDidChangeActiveTextEditor(update),
      vscode.workspace.onDidChangeTextDocument(event => { if (event.document === vscode.window.activeTextEditor?.document) update(); }),
    ];
    update();
  }
  async run(uri?: vscode.Uri): Promise<ValidationSummary | undefined> {
    if (this.disposed) return;
    if (this.running) { void vscode.window.showInformationMessage('OpenChoreo validation is already running.'); return; }
    const doc = uri ? vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString()) : vscode.window.activeTextEditor?.document;
    if (!canValidateRendering(doc)) { void vscode.window.showErrorMessage('Open an OpenChoreo YAML resource to run validation.'); return; }
    const document = doc!;
    const remote = document.uri.scheme === 'openchoreo';
    this.running = true;
    try {
      return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'OpenChoreo: Validating current project', cancellable: false }, async () => {
        const session = this.server()?.renderingSession(remote);
        if (!session) throw new Error('The OpenChoreo language server is not running. Run occ login if needed, then OpenChoreo: Restart Language Server.');
        const project = currentValidationProject(document, this.auth.getContextInfo());
        const versions = new Map<vscode.TextDocument, number>();
        let result: ValidationSummary;
        if (remote) {
          const contextId = getResourceContextId();
          if (!contextId || document.uri.authority !== contextId) throw new Error('This resource belongs to another context. Reopen it from the active Explorer.');
          const parts = document.uri.path.split('/').filter(Boolean);
          const namespace = parts[0] === 'namespaces' ? parts[1] : this.auth.getContextInfo()?.namespace;
          if (!namespace) throw new Error('Select an OpenChoreo namespace before validating Explorer resources.');
          const snapshot = await collectNamespaceValidation(this.api, { contextId, namespace, generation: session.generation, projectName: project.projectName, activeUri: document.uri.toString() }, vscode.workspace.textDocuments, () => !this.disposed && session.current());
          if (!snapshot.documents.some(d => d.uri === document.uri.toString())) throw new Error('This resource is not available in the cluster snapshot. Refresh the Explorer and retry.');
          for (const d of vscode.workspace.textDocuments) if (snapshot.documents.some(input => input.uri === d.uri.toString())) versions.set(d, d.version);
          result = await session.execute('openchoreo.runClusterValidation', [snapshot]);
        } else {
          const snapshots = vscode.workspace.textDocuments.filter(d => d.uri.scheme === 'file' && d.languageId === 'yaml').map(d => {
            versions.set(d, d.version); return { URI: d.uri.toString(), Text: d.getText(), Version: d.version };
          });
          result = await session.execute('openchoreo.runPostRenderValidation', [document.uri.toString(), snapshots, project]);
        }
        if (this.disposed || !session.current() || [...versions].some(([d, version]) => (!result.validatedUris || result.validatedUris.includes(d.uri.toString())) && (d.isClosed || d.version !== version))) throw new Error('Resources changed during validation. Run it again.');
        this.output.clear();
        this.output.appendLine(`Scope: ${result.root ?? document.uri.toString()}`);
        this.output.appendLine(`${result.files} resources/files checked; ${result.errors} errors, ${result.warnings} warnings.`);
        for (const detail of result.details ?? []) this.output.appendLine(detail);
        const counts = `${result.errors} errors, ${result.warnings} warnings (${result.files} resources/files).`;
        const summary = result.message ? `${result.message} ${counts}` : `Validation completed: ${counts}`;
        const notification = result.errors ? vscode.window.showErrorMessage(summary, 'Show Problems', 'Show Output')
          : result.warnings ? vscode.window.showWarningMessage(summary, 'Show Problems', 'Show Output')
          : vscode.window.showInformationMessage(summary, 'Show Output');
        void notification.then(action => {
          if (this.disposed) return;
          if (action === 'Show Problems') void vscode.commands.executeCommand('workbench.actions.view.problems');
          if (action === 'Show Output') this.output.show(true);
        });
        return result;
      });
    } catch (error) {
      if (this.disposed) return;
      // Only our fixed errors and protocol errors are displayed; never log API bodies.
      const message = error instanceof Error ? error.message : 'Validation failed. Check OpenChoreo Language Server output.';
      this.output.appendLine(message);
      void vscode.window.showErrorMessage(message, 'Show Output').then(action => { if (!this.disposed && action === 'Show Output') this.output.show(true); });
      return;
    } finally { this.running = false; }
  }
  dispose(): void { this.disposed = true; for (const subscription of this.subscriptions) subscription.dispose(); this.output.dispose(); }
}

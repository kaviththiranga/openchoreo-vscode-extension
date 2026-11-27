// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * The GitOps scenes' workspace: a clone of the sample-gitops fork that Flux
 * syncs into the gitops-demo namespace (DEMO_WORKSPACE, prepared by
 * demo/seed/workspaces-gitops.sh). Every scene resets it in `setup`, so takes
 * can be repeated: back to main with no local edits, generated files or
 * branches, then the scene's own work in progress.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { api, occ } from '../../cluster';

export const GREETER = 'namespaces/gitops-demo/projects/shop/components/greeter';
export const COMPONENT = `${GREETER}/component.yaml`;
export const WORKLOAD = `${GREETER}/workload.yaml`;

export function workspaceRoot(): string {
  const root = process.env.DEMO_WORKSPACE;
  if (!root || !fs.existsSync(path.join(root, '.git'))) {
    throw new Error('DEMO_WORKSPACE must be the shop-gitops clone from demo/seed/workspaces-gitops.sh');
  }
  return path.resolve(root);
}

function git(...args: string[]): string {
  return execFileSync('git', ['-C', workspaceRoot(), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** A file's new content, or a change to its current content. */
export type Edit = string | ((text: string) => string);

/** Back to a clean main (commits from earlier takes stay on their deleted branches), then apply `edits`. */
export function resetWorkspace(edits: Record<string, Edit> = {}): void {
  // File by file first: VS Code's watcher may report only the folder when git
  // removes a whole directory, and the GitOps index would keep its files.
  for (const file of git('ls-files', '--others', '-z').split('\0')) {
    if (file) fs.rmSync(path.join(workspaceRoot(), file), { force: true });
  }
  git('checkout', '-q', '-f', 'main');
  git('reset', '-q', '--hard', 'HEAD');
  git('clean', '-q', '-fdx');
  for (const branch of git('for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n')) {
    if (branch && branch !== 'main') git('branch', '-q', '-D', branch);
  }
  for (const [file, edit] of Object.entries(edits)) {
    const target = path.join(workspaceRoot(), file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const before = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    const after = typeof edit === 'string' ? edit : edit(before);
    if (after === before) throw new Error(`edit of ${file} changed nothing`);
    fs.writeFileSync(target, after);
  }
}

/** Write these files again as they are, so a file watcher that missed them reports them now. */
export function touch(files: string[]): void {
  for (const file of files) {
    const target = path.join(workspaceRoot(), file);
    fs.writeFileSync(target, fs.readFileSync(target));
  }
}

/** Work in progress: greeter gets an autoscaler. */
export const AUTOSCALER: Record<string, Edit> = {
  [COMPONENT]: (text) => `${text.trimEnd()}
  traits:
    - kind: ClusterTrait
      name: horizontal-pod-autoscaler
      instanceName: autoscaler
      parameters:
        replicas:
          min: 2
          max: 5
`,
};

/** Work in progress: a new cart service, not on the cluster yet. */
export const CART: Record<string, Edit> = {
  'namespaces/gitops-demo/projects/shop/components/cart/component.yaml': `apiVersion: openchoreo.dev/v1alpha1
kind: Component
metadata:
  name: cart
  namespace: gitops-demo
spec:
  owner:
    projectName: shop
  componentType:
    kind: ClusterComponentType
    name: deployment/service
`,
  'namespaces/gitops-demo/projects/shop/components/cart/workload.yaml': `apiVersion: openchoreo.dev/v1alpha1
kind: Workload
metadata:
  name: cart
  namespace: gitops-demo
spec:
  owner:
    projectName: shop
    componentName: cart
  container:
    image: registry.example.com/shop/cart:1.0.0
  endpoints:
    http:
      type: HTTP
      port: 8080
`,
};

/**
 * Drift the other way: an Environment someone created through the console,
 * on the cluster but not in Git. Flux prunes only what it applied, so it stays.
 */
export async function ensureClusterOnlyEnvironment(): Promise<void> {
  const { status } = await api('GET', '/api/v1/namespaces/gitops-demo/environments/qa');
  if (status === 200) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-demo-gitops-'));
  try {
    const file = path.join(dir, 'qa.yaml');
    fs.writeFileSync(file, `apiVersion: openchoreo.dev/v1alpha1
kind: Environment
metadata:
  name: qa
  namespace: gitops-demo
  annotations:
    openchoreo.dev/display-name: QA
spec:
  dataPlaneRef:
    kind: ClusterDataPlane
    name: default
  isProduction: false
`);
    occ(['apply', '-f', file]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

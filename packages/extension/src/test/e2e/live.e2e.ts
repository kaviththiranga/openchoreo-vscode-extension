// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Optional checks against a real OpenChoreo control plane, using the occ CLI
 * session in ~/.openchoreo/config. Skipped unless OPENCHOREO_E2E_RESOURCE
 * names a resource the session can read, as an openchoreo:// path, e.g.
 *   OPENCHOREO_E2E_RESOURCE=/namespaces/default/environment/development.yaml
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

const resource = process.env.OPENCHOREO_E2E_RESOURCE;

(resource ? describe : describe.skip)('OpenChoreo extension against a live cluster (e2e)', () => {
  it(`reads ${resource ?? 'a resource'} through the openchoreo:// filesystem`, async () => {
    // The session is read asynchronously after activation; retry while it connects.
    let text = '';
    let lastError: unknown;
    for (let i = 0; i < 30 && !text; i++) {
      try {
        text = new TextDecoder().decode(
          await vscode.workspace.fs.readFile(vscode.Uri.from({ scheme: 'openchoreo', path: resource! })),
        );
      } catch (err) {
        lastError = err;
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }
    assert.ok(text, `could not read ${resource}: ${String(lastError)}`);
    assert.match(text, /^apiVersion: openchoreo\.dev\/v1alpha1$/m);
    assert.match(text, /^kind: \w+$/m);
  });
});

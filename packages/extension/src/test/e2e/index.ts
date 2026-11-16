// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as fs from 'fs';
import * as path from 'path';
import Mocha from 'mocha';

/** Entry point VS Code calls inside the extension host (extensionTestsPath). */
export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', timeout: 60_000, color: true });
  for (const file of fs.readdirSync(__dirname).filter((f) => f.endsWith('.e2e.js')).sort()) {
    mocha.addFile(path.join(__dirname, file));
  }
  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures > 0 ? reject(new Error(`${failures} e2e test(s) failed`)) : resolve()));
  });
}

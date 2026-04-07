// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { render } from 'preact';
import { App } from './App';

import '@vscode/codicons/dist/codicon.css';

const root = document.getElementById('root');
if (root) {
  render(<App />, root);
}

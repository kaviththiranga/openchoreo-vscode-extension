// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import { bootstrapSnippets } from './bootstrapSnippets';
import { celCompletions } from './celCompletions';
import { hoverAndOutline } from './hoverAndOutline';
import { liveValidation } from './liveValidation';
import { parameterCompletions } from './parameterCompletions';
import { smartCompletions } from './smartCompletions';

/**
 * Completions, validation, hover and outline in OpenChoreo YAML, with the
 * bundled language server. Workspaces: demo/seed/workspaces-language.sh.
 * url-shortener: smart-completions, parameter-completions, hover-and-outline, live-validation.
 * platform-config: cel-completions, bootstrap-snippets.
 */
export const languageScenes: Scene[] = [
  smartCompletions,
  parameterCompletions,
  // Before live-validation: its problems stay in the status bar after the file is gone.
  hoverAndOutline,
  liveValidation,
  celCompletions,
  bootstrapSnippets,
];

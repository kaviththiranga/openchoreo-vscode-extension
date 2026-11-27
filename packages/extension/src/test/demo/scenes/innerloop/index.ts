// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import { cloneSource } from './cloneSource';
import { debugAgainstEnv } from './debugAgainstEnv';
import { buildThisCommit, followAfterPush, linkedComponent } from './linkedComponent';
import { openShell } from './openShell';
import { runLocally } from './runLocally';
import { runtimeLogs } from './runtimeLogs';

/** Linked components, local runs and debugging against environments, shells and runtime logs. */
export const innerLoopScenes: Scene[] = [
  linkedComponent,
  buildThisCommit,
  followAfterPush,
  debugAgainstEnv,
  runLocally,
  openShell,
  runtimeLogs,
  cloneSource,
];

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import { compareWithCluster, compareWithRepository } from './compare';
import { gitopsGenerateReleases } from './generateReleases';
import { goToDefinition } from './goToDefinition';
import { gitopsGuard } from './guard';
import { gitopsPromote } from './promote';
import { gitopsSyncView } from './syncView';

/**
 * GitOps repositories: sync view, save guard, compare, releases and promotion
 * in the repository, Go to Definition. All run in the shop-gitops clone from
 * demo/seed/workspaces-gitops.sh (DEMO_WITH=cluster,gitops-workspace).
 */
export const gitopsScenes: Scene[] = [
  gitopsSyncView,
  gitopsGuard,
  compareWithCluster,
  compareWithRepository,
  goToDefinition,
  gitopsGenerateReleases,
  gitopsPromote,
];

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import { createResource } from './createResource';
import { deleteResource } from './deleteResource';
import { editAndSave } from './editAndSave';
import { explorerTour } from './explorerTour';
import { scaffoldFromSource } from './scaffoldFromSource';
import { switchNamespace } from './switchNamespace';

/**
 * Sidebar explorer, editing and creating resources, scaffolding from source.
 * scaffold-from-source opens its own folder, so it runs in a capture of its own.
 */
export const exploreScenes: Scene[] = [explorerTour, switchNamespace, editAndSave, createResource, deleteResource, scaffoldFromSource];

// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Scene } from '../../demo';
import { buildLogs } from './buildLogs';
import { compareReleases } from './compareReleases';
import { deployedResources } from './deployedResources';
import { deployRelease } from './deployRelease';
import { failedBuild } from './failedBuild';
import { generateRelease } from './generateRelease';
import { promote } from './promote';
import { rollBack } from './rollBack';
import { runNow } from './runNow';
import { triggerBuild } from './triggerBuild';

/** Builds, releases, deployments, promotion and rollback. */
export const deliveryScenes: Scene[] = [triggerBuild, buildLogs, generateRelease, deployRelease, promote, deployedResources, compareReleases, rollBack, runNow, failedBuild];

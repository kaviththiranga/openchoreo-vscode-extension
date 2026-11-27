// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/** Seeded demo data the delivery scenes use (see the cluster status notes). */

/** Source-built component whose build is fast; build-logs shows `firstStep` finish and `logStep` stream. */
export const BUILD = { project: 'default', component: 'greeting-service', firstStep: 'checkout-source', logStep: 'build-image' };

/**
 * The component the release, promote, compare and roll back scenes work on.
 * Seeded state (restored by the scenes' setups): development and staging run
 * v2, production v1; v2 adds RATE_LIMIT_PER_MINUTE. generate-release
 * generates `<component>-v3`, `-v4`… (the demo login can't delete releases,
 * so each take adds one; delete them with kubectl before a final take).
 */
export const PIPELINE = {
  project: 'url-shortener',
  component: 'snip-api-service',
  v1: 'snip-api-service-6bcb7db9b5',
  v2: 'snip-api-service-8c6778b5c',
};

/** Component and environment whose deployed resources tree is shown: production (v1) isn't changed by any scene and serves traffic. */
export const DEPLOYED = { project: 'url-shortener', component: 'snip-api-service', environment: 'production' };

/** Scheduled-task (cronjob) component. */
export const CRON = { project: 'default', component: 'github-issue-reporter', environment: 'development' };

/** Component whose latest build failed (a Go compile error in the image build step). */
export const FAILED = { project: 'latency-lab', component: 'lab-api-service-broken', error: 'undefined: undefinedHandler' };

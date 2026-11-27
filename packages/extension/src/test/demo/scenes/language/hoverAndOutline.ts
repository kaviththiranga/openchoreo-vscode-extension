// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import type { Locator } from 'playwright-core';
import type { Demo, Scene } from '../../demo';
import {
  closePanel, editorToken, explorerLayout, holdWithStill, hover, hoverWidget, openWorkspaceFile, resetWorkspace,
} from './helpers';

const API_SERVICE = 'openchoreo/components/api-service.yaml';

const outlinePane = (demo: Demo): Locator =>
  demo.page.locator('.part.sidebar .pane', { has: demo.page.locator('.pane-header', { hasText: /^Outline/ }) }).first();

/** A row of the Outline tree by its label. */
const outlineRow = (demo: Demo, label: RegExp): Locator =>
  outlinePane(demo).locator('.monaco-list-row', { has: demo.page.locator('.label-name', { hasText: label }) }).first();

/** Off camera: fold the Outline to the document's top-level keys. */
async function collapseOutline(demo: Demo): Promise<void> {
  const pane = outlinePane(demo);
  await pane.locator('.pane-header').hover();
  await pane.locator('.pane-header .action-label[aria-label^="Collapse"]').first().click();
  await demo.pause(300);
}

/** Unfold an Outline row on camera. */
async function expand(demo: Demo, label: RegExp): Promise<void> {
  const row = outlineRow(demo, label);
  await row.waitFor({ timeout: 10_000 });
  if ((await row.getAttribute('aria-expanded')) !== 'true') await demo.click(row.locator('.monaco-tl-twistie'));
  await demo.pause(500);
}

/**
 * Hover documentation on a field, then the Outline of a file holding a
 * Component and its Workload: one entry per document, and hover docs from
 * each document's own schema.
 *   DEMO_WORKSPACE=<language>/url-shortener
 */
export const hoverAndOutline: Scene = {
  name: 'hover-and-outline',
  title: 'Field documentation on hover, and the Outline of a Component and its Workload in one file',
  requires: ['workspace'],
  async setup(demo) {
    resetWorkspace();
    await closePanel(demo);
    await explorerLayout(demo, { files: false, outline: true, width: 380 });
    await openWorkspaceFile(demo, API_SERVICE);
    await outlineRow(demo, /^Workload snip-api-service/).waitFor({ timeout: 30_000 });
    await collapseOutline(demo);
    await demo.goTo(1, 1);
  },
  async run(demo) {
    // The field's type, description and constraints.
    await hover(demo, editorToken(demo, 'name: deployment/service', 'name'));
    const tooltip = hoverWidget(demo, 'spec.componentType.name');
    await tooltip.waitFor({ timeout: 10_000 });
    await demo.pause(300);
    await demo.mark('hover', tooltip);
    await holdWithStill(demo, 'hover', 1800);

    // One Outline entry per document; picking a key moves the editor and breadcrumbs.
    await expand(demo, /^Workload snip-api-service/);
    await expand(demo, /^spec$/);
    const container = outlineRow(demo, /^container$/);
    await container.waitFor({ timeout: 10_000 });
    await demo.pause(500);
    await demo.mark('outline', demo.page.locator('.part.sidebar'));
    await holdWithStill(demo, 'outline', 300);
    await demo.click(container);
    const image = editorToken(demo, 'image: cr.openchoreo.dev', 'image');
    await image.waitFor({ timeout: 10_000 });
    await demo.pause(700);

    // Hover docs come from the Workload schema in the second document.
    await hover(demo, image);
    const imageDocs = hoverWidget(demo, 'spec.container.image');
    await imageDocs.waitFor({ timeout: 10_000 });
    await demo.pause(300);
    await demo.mark('key', demo.page.locator('.part.editor'));
    await holdWithStill(demo, 'workload-hover', 1700);
  },
};

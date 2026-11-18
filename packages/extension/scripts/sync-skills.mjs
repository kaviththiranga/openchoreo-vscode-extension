// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Mirrors the OpenChoreo agent skills (github.com/openchoreo/skills) into
 * ./skills at the commit pinned by `openchoreoSkills.ref` in package.json, so
 * the extension ships them without keeping copies in this repository.
 *
 *   node scripts/sync-skills.mjs              # fetch if the pinned commit isn't there yet
 *   node scripts/sync-skills.mjs --ref <sha>  # pin another commit, then fetch
 *   node scripts/sync-skills.mjs --required   # fail instead of warning when offline
 *
 * Fails when upstream adds or removes a skill without a matching
 * `contributes.chatSkills` entry; update the manifest to match.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestFile = path.join(extensionRoot, 'package.json');
const skillsDir = path.join(extensionRoot, 'skills');
const markerFile = path.join(skillsDir, '.ref');
const argv = process.argv.slice(2);
const required = argv.includes('--required');
const newRef = argv.includes('--ref') ? argv[argv.indexOf('--ref') + 1] : undefined;

const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
if (newRef) {
  manifest.openchoreoSkills.ref = newRef;
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
}
const { repository, ref } = manifest.openchoreoSkills;

if (fs.existsSync(markerFile) && fs.readFileSync(markerFile, 'utf8').trim() === ref) {
  check();
  process.exit(0);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'openchoreo-skills-'));
try {
  const archive = path.join(work, 'skills.tar.gz');
  const url = `https://codeload.github.com/${repository}/tar.gz/${ref}`;
  const response = await fetch(url).catch((err) => ({ ok: false, status: String(err) }));
  if (!response.ok) {
    const message = `Cannot download ${repository}@${ref} (${response.status}).`;
    if (required || !fs.existsSync(skillsDir)) fail(message);
    console.warn(`${message} Keeping the skills already in ./skills.`);
    check();
    process.exit(0);
  }
  fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  const untar = spawnSync('tar', ['-xzf', archive, '-C', work], { encoding: 'utf8' });
  if (untar.status !== 0) fail(`Extracting the skills archive failed: ${untar.stderr}`);

  const source = path.join(work, fs.readdirSync(work).find((name) => name !== 'skills.tar.gz'));
  fs.rmSync(skillsDir, { recursive: true, force: true });
  fs.cpSync(path.join(source, 'skills'), skillsDir, { recursive: true });
  fs.copyFileSync(path.join(source, 'LICENSE'), path.join(skillsDir, 'LICENSE'));
  fs.writeFileSync(
    path.join(skillsDir, 'README.md'),
    `Mirrored from https://github.com/${repository} at ${ref} by scripts/sync-skills.mjs. Do not edit.\n`,
  );
  fs.writeFileSync(markerFile, `${ref}\n`);
  console.log(`Synced ${repository}@${ref.slice(0, 12)} into ./skills`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
check();

/** Every mirrored skill must be contributed, and every contribution must exist. */
function check() {
  const shipped = fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skillsDir, entry.name, 'SKILL.md')))
    .map((entry) => `./skills/${entry.name}/SKILL.md`)
    .sort();
  const contributed = (manifest.contributes.chatSkills ?? []).map((s) => s.path).sort();
  const missing = shipped.filter((p) => !contributed.includes(p));
  const stale = contributed.filter((p) => !shipped.includes(p));
  if (missing.length || stale.length) {
    fail(
      'contributes.chatSkills is out of date with the mirrored skills.\n' +
        (missing.length ? `  add:    ${missing.join(', ')}\n` : '') +
        (stale.length ? `  remove: ${stale.join(', ')}\n` : ''),
    );
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

#!/usr/bin/env node
// Copy the finished media a repo should keep into a docs folder, sized for git and READMEs, and
// write a catalog page (one row per scene: hook, caption, video, still, GIF) to build a blog or
// release post from.
//
//   node scripts/tools/publish_media.mjs [--out ../docs/media] [--base-url <url of --out>] [--aspects 16x9] [--crf 30]
//
// Per scene (storyboard.yaml):
//   video  out/final/shorts/<id>-<aspect>.mp4 → <out>/videos/<id>[-<aspect>].mp4, re-encoded
//          (H.264, CRF 30 by default, +faststart): UI text stays crisp up to CRF ~32 at a
//          fraction of the size (~1.2-1.5 MB for a 15 s 1080p short)
//   still  out/shots/<id>-NN-<label>.png → <out>/screens/<id>.png, 1600 px wide. `still: <label>`
//          picks one; default: the scene's last still
//   gif    `gif: true` → out/final/gifs/<id>.gif → <out>/gifs/<id>.gif (README-sized already)
//   reel   out/final/demo-16x9.mp4 / demo-9x16.mp4 → <out>/videos/<product-slug>-reel[-9x16].mp4
//   tour   out/final/tour-16x9.mp4 / tour-9x16.mp4 → <out>/videos/<product-slug>-tour[-9x16].mp4
// Run after `make render`. Re-running replaces what it wrote; files of scenes no longer in the
// storyboard are left alone (delete them yourself).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const DEMO = path.resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const out = path.resolve(DEMO, opt('out', '../docs/media'));
const baseUrl = opt('base-url', '');
const aspects = opt('aspects', '16x9').split(',');
const crf = opt('crf', '30');
const board = parse(fs.readFileSync(path.join(DEMO, 'storyboard.yaml'), 'utf8'));
const slug = (board.product?.name ?? 'demo').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const run = (cmd, argv) => {
  const r = spawnSync(cmd, argv, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(' ')}\n${r.stderr}`);
};
const encode = (src, dst) => {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-c:v', 'libx264', '-preset', 'slow', '-crf', crf,
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', dst]);
};
const resize = (src, dst, width = 1600) => {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', `scale=${width}:-2:flags=lanczos`, '-compression_level', '9', dst]);
};
const mb = (f) => (fs.statSync(f).size / 1e6).toFixed(1);
const rel = (f) => path.relative(out, f).split(path.sep).join('/');
const link = (f) => (baseUrl ? `${baseUrl.replace(/\/$/, '')}/${rel(f)}` : rel(f));

const shots = fs.existsSync(path.join(DEMO, 'out/shots')) ? fs.readdirSync(path.join(DEMO, 'out/shots')).sort() : [];
const rows = [];
let total = 0;
for (const s of board.scenes ?? []) {
  const row = { s, files: [] };
  for (const a of aspects) {
    const src = path.join(DEMO, `out/final/shorts/${s.id}-${a}.mp4`);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(out, 'videos', aspects.length === 1 ? `${s.id}.mp4` : `${s.id}-${a}.mp4`);
    encode(src, dst);
    row.files.push(['video', dst, a]);
  }
  const mine = shots.filter((f) => f.startsWith(`${s.id}-`) && /^\d\d-/.test(f.slice(s.id.length + 1)) && !f.includes('failure'));
  const still = s.still ? mine.find((f) => f.slice(s.id.length + 4).replace(/\.png$/, '') === s.still) : mine[mine.length - 1];
  if (s.still && !still) console.warn(`  ${s.id}: no still labelled "${s.still}" (have: ${mine.join(', ') || 'none'})`);
  if (still) {
    const dst = path.join(out, 'screens', `${s.id}.png`);
    resize(path.join(DEMO, 'out/shots', still), dst);
    row.files.push(['still', dst]);
  }
  if (s.gif) {
    const src = path.join(DEMO, `out/final/gifs/${s.id}.gif`);
    if (fs.existsSync(src)) {
      const dst = path.join(out, 'gifs', `${s.id}.gif`);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      row.files.push(['gif', dst]);
    } else console.warn(`  ${s.id}: gif: true but out/final/gifs/${s.id}.gif is missing (make gifs)`);
  }
  for (const [, f] of row.files) total += fs.statSync(f).size;
  rows.push(row);
}
const reels = [];
for (const [src, name] of [
  ['demo-16x9.mp4', `${slug}-reel.mp4`], ['demo-9x16.mp4', `${slug}-reel-9x16.mp4`],
  ['tour-16x9.mp4', `${slug}-tour.mp4`], ['tour-9x16.mp4', `${slug}-tour-9x16.mp4`],
]) {
  const from = path.join(DEMO, 'out/final', src);
  if (!fs.existsSync(from)) continue;
  const dst = path.join(out, 'videos', name);
  encode(from, dst);
  reels.push(dst);
  total += fs.statSync(dst).size;
}

// Catalog: grouped by the storyboard's `area` field when present.
const lines = [`# ${board.product?.name ?? 'Demo'} - media`, '',
  'Short feature videos, stills and GIFs, generated from `demo/` (see its README to regenerate).', ''];
const reelLinks = (re) => reels.filter((f) => re.test(path.basename(f))).map((f) => `[${path.basename(f)}](${link(f)}) (${mb(f)} MB)`).join(' · ');
if (reels.some((f) => /-reel/.test(f))) lines.push('**Highlight reel:** ' + reelLinks(/-reel/), '');
if (reels.some((f) => /-tour/.test(f))) lines.push('**Every feature in one video:** ' + reelLinks(/-tour/), '');
if (board.style?.music && board.outro?.credit) lines.push(`_${board.outro.credit}_`, '');
let area;
for (const { s, files } of rows) {
  if (s.area && s.area !== area) {
    area = s.area;
    if (lines[lines.length - 1] !== '') lines.push('');
    lines.push(`## ${area}`, '', '| Feature | Hook / caption | Files |', '|---|---|---|');
  } else if (!area && rows[0].s === s) lines.push('| Feature | Hook / caption | Files |', '|---|---|---|');
  const still = files.find(([k]) => k === 'still');
  const thumb = still ? `<img src="${link(still[1])}" width="320" alt="${s.title}">` : '';
  const fileLinks = files.map(([k, f, a]) => `[${k === 'video' && aspects.length > 1 ? a : k}](${link(f)})`).join(' · ');
  lines.push(`| **${s.title}**<br>${thumb} | **${s.hook ?? ''}**<br>${s.caption ?? ''} | ${fileLinks} |`);
}
lines.push('');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'README.md'), lines.join('\n'));
console.log(`published ${rows.length} scenes + ${reels.length} reel(s) to ${path.relative(process.cwd(), out) || out} (${(total / 1e6).toFixed(1)} MB)`);

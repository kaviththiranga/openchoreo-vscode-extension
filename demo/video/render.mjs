#!/usr/bin/env node
// Render everything from public/timeline.json with ONE bundle and ONE browser (much faster
// than a `remotion render` per file when there are dozens of shorts).
//
//   node render.mjs <what...> [--scenes a,b] [--aspects 16x9,9x16,1x1] [--browser PATH]
//                             [--concurrency N] [--gif-mb 5]
//   what: reel | tour | shorts | gifs | posters | all
//
// Writes (relative to demo/):
//   out/final/demo-16x9.mp4, out/final/demo-9x16.mp4       reel
//   out/final/tour-16x9.mp4, out/final/tour-9x16.mp4       tour (every feature, chaptered)
//   out/final/shorts/<id>-<16x9|9x16|1x1>.mp4              shorts
//   out/final/gifs/<id>.gif                                README GIFs (clip only, looping)
//   out/final/posters/<id>.png                             key-moment stills
// MP4s are H.264, yuv420p, with the moov atom up front (+faststart) for instant web playback.
import { bundle } from '@remotion/bundler';
import { openBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HERE = import.meta.dirname;
const DEMO = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const list = (v) => (v ? String(v).split(/[\s,]+/).filter(Boolean) : []);
let what = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (!what.length || what.includes('all')) what = ['reel', 'tour', 'shorts', 'gifs', 'posters'];
const onlyScenes = list(opt('scenes', process.env.SCENES));
const aspects = list(opt('aspects', process.env.ASPECTS)).length ? list(opt('aspects', process.env.ASPECTS)) : ['16x9', '9x16', '1x1'];
const browserExecutable = opt('browser', process.env.REMOTION_BROWSER) || null;
const concurrency = Number(opt('concurrency', 0)) || Math.max(2, Math.floor(os.cpus().length * 0.75));
const gifMb = Number(opt('gif-mb', 5));

const timeline = JSON.parse(fs.readFileSync(path.join(HERE, 'public/timeline.json'), 'utf8'));
const scenes = timeline.scenes.filter((s) => !onlyScenes.length || onlyScenes.includes(s.id));
const out = (...p) => {
  const f = path.join(DEMO, 'out/final', ...p);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  return f;
};

const t0 = Date.now();
console.log('bundling…');
const serveUrl = await bundle({ entryPoint: path.join(HERE, 'src/index.ts'), onProgress: () => {} });
const browser = await openBrowser('chrome', { browserExecutable });
const common = { serveUrl, puppeteerInstance: browser, browserExecutable, logLevel: 'error' };

function faststart(file) {
  // Remotion's stitcher may leave the moov atom at the end; remux (no re-encode) to be sure.
  const tmp = `${file}.tmp.mp4`;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-c', 'copy', '-movflags', '+faststart', tmp]);
  if (r.status === 0) fs.renameSync(tmp, file);
  else fs.rmSync(tmp, { force: true });
}

async function video(id, inputProps, file, extra = {}) {
  const started = Date.now();
  const composition = await selectComposition({ ...common, id, inputProps });
  await renderMedia({
    ...common,
    composition,
    inputProps,
    codec: 'h264',
    pixelFormat: 'yuv420p',
    crf: 18,
    imageFormat: 'jpeg',
    jpegQuality: 92,
    concurrency,
    outputLocation: file,
    ...extra,
  });
  faststart(file);
  const name = file.startsWith(DEMO) ? path.relative(DEMO, file) : `${id} ${inputProps.scene ?? ''}`.trim();
  console.log(`  ${name}  ${(composition.durationInFrames / composition.fps).toFixed(1)}s  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
}

try {
  if (what.includes('reel')) {
    console.log('reel');
    if (!timeline.reel.scenes.length) console.log('  no scenes - skipped');
    else {
      if (aspects.includes('16x9')) await video('Landscape', {}, out('demo-16x9.mp4'));
      if (aspects.includes('9x16')) await video('Portrait', {}, out('demo-9x16.mp4'));
    }
  }
  if (what.includes('tour')) {
    console.log('tour');
    if (!timeline.tour?.items.length) console.log('  no scenes - skipped');
    else {
      if (aspects.includes('16x9')) await video('Tour-16x9', {}, out('tour-16x9.mp4'));
      if (aspects.includes('9x16')) await video('Tour-9x16', {}, out('tour-9x16.mp4'));
    }
  }
  if (what.includes('shorts')) {
    console.log('shorts');
    for (const s of scenes) for (const a of aspects) await video(`Short-${a}`, { scene: s.id }, out('shorts', `${s.id}-${a}.mp4`));
  }
  if (what.includes('gifs')) {
    console.log('gifs');
    const tool = path.join(DEMO, 'scripts/tools/make_gif.sh');
    for (const s of scenes) {
      const tmp = path.join(os.tmpdir(), `clip-${s.id}-${process.pid}.mp4`);
      await video('Clip-16x9', { scene: s.id }, tmp, { scale: 0.5 }); // 960x540
      const r = spawnSync(tool, [tmp, out('gifs', `${s.id}.gif`), '--max-mb', String(gifMb)], { stdio: 'inherit' });
      fs.rmSync(tmp, { force: true });
      if (r.status !== 0) throw new Error(`make_gif.sh failed for ${s.id}`);
    }
  }
  if (what.includes('posters')) {
    console.log('posters');
    for (const s of scenes) {
      const inputProps = { scene: s.id };
      const composition = await selectComposition({ ...common, id: 'Poster', inputProps });
      const file = out('posters', `${s.id}.png`);
      await renderStill({ ...common, composition, inputProps, output: file, imageFormat: 'png', frame: 0 });
      console.log(`  ${path.relative(DEMO, file)}`);
    }
  }
} finally {
  await browser.close({ silent: true }).catch(() => {});
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

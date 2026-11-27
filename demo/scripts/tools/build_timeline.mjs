#!/usr/bin/env node
// Measure raw clips + narration audio and write the edit plan for the reel and the shorts.
//
//   node scripts/tools/build_timeline.mjs [--allow-missing] [--full] [--intro-s 1.5] [--outro-s 2.5]
//
//   --allow-missing  skip scenes whose clip is not recorded yet (default: fail)
//   --full           reel uses whole clips, no trim/speed/auto camera (the ffmpeg-only path)
//
// Reads:  storyboard.yaml, out/raw/<id>.(mp4|webm|mov|mkv), out/raw/<id>.json (key_moment_s,
//         marks: [{label, t, box:{x,y,w,h}}]), out/audio/<id>.mp3
// Writes: video/public/timeline.json      (frames; read by the Remotion project)
//         video/public/{clips,audio}/     (copies of the media Remotion plays)
//         out/final/timeline.json         (reel, seconds; extract_frames.sh / detect_issues.sh)
//         out/final/shorts/<id>.timeline.json  (same, per short)
//         out/final/captions.srt          (reel captions sidecar)
//
// Per scene it plans a window (trim), a time map (speed ramps; idle stretches play fast), camera
// targets (marks with boxes; marks without boxes and unmarked clips get boxes from motion), and
// camera keyframes for each layout. The logic lives in timeline_lib.mjs (unit-tested).
import { parse } from 'yaml';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as L from './timeline_lib.mjs';

const DEMO = path.resolve(import.meta.dirname, '../..');
const at = (...p) => path.join(DEMO, ...p);
const args = process.argv.slice(2);
const allowMissing = args.includes('--allow-missing');
const full = args.includes('--full');
const argNum = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : def;
};

const board = parse(fs.readFileSync(at('storyboard.yaml'), 'utf8'));
const style = board.style ?? {};
const FPS = L.FPS;
const f = (s) => Math.round(s * FPS);
const sec = (fr) => +(fr / FPS).toFixed(2);
const INTRO_S = argNum('--intro-s', full ? 2.5 : 1.5);
const OUTRO_S = argNum('--outro-s', full ? 3.0 : 2.5);
const HOOK_F = f(style.shorts?.hook_s ?? 1.1);
const END_F = f(style.shorts?.end_s ?? 1.7);
const OVERLAP_F = 6; // cards overlap the clip by this much (crossfade)
const REEL = { max_s: 110, rate: 2.2, ...(style.reel ?? {}) };
const TOUR = { rate: 2.2, chapter_s: 2.2, ...(style.tour ?? {}) };
const VOICE_LEAD_S = 0.3;
const VOICE_TAIL_S = 0.6;
const IGNORE = style.motion_ignore ?? [];

const pub = at('video/public');
fs.mkdirSync(path.join(pub, 'clips'), { recursive: true });
fs.mkdirSync(path.join(pub, 'audio'), { recursive: true });
fs.mkdirSync(at('out/final/shorts'), { recursive: true });

function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_frames,r_frame_rate:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  if (r.status === 0) {
    const j = JSON.parse(r.stdout);
    const s = j.streams?.[0] ?? {};
    const [n, d] = String(s.r_frame_rate ?? '30/1').split('/').map(Number);
    const dur = parseFloat(j.format?.duration);
    if (Number.isFinite(dur)) return { duration: dur, width: s.width ?? 1920, height: s.height ?? 1080, fps: n / (d || 1) || 30 };
  }
  // Fallback when only ffmpeg is installed: read "Duration: 00:00:05.73, ... 1920x1080" from its banner.
  const b = spawnSync('ffmpeg', ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr ?? '';
  const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(b);
  const wh = /, (\d{2,5})x(\d{2,5})/.exec(b);
  let duration = m ? +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]) : NaN;
  if (!Number.isFinite(duration)) {
    // WebM from some recorders has no duration header: decode to count it.
    const d = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
    const t = [...(d.stderr ?? '').matchAll(/time=(\d+):(\d+):([\d.]+)/g)].at(-1);
    if (t) duration = +t[1] * 3600 + +t[2] * 60 + parseFloat(t[3]);
  }
  if (!Number.isFinite(duration)) throw new Error(`cannot read duration of ${file} (install ffprobe)`);
  return { duration, width: wh ? +wh[1] : 1920, height: wh ? +wh[2] : 1080, fps: 30 };
}

/** Small grayscale frames for motion analysis (10 fps, 160 px wide). */
function motionFrames(file, width, height) {
  const w = 160, h = Math.max(2, Math.round((w * height) / width / 2) * 2), fps = 10;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `fps=${fps},scale=${w}:${h}:flags=area,format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) return null;
  const data = [];
  for (let i = 0; i + w * h <= r.stdout.length; i += w * h) data.push(r.stdout.subarray(i, i + w * h));
  return { w, h, fps, data };
}

function copyTo(src, rel) {
  const dst = path.join(pub, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const same = fs.existsSync(dst) && fs.statSync(dst).size === fs.statSync(src).size && fs.statSync(dst).mtimeMs >= fs.statSync(src).mtimeMs;
  if (!same) fs.copyFileSync(src, dst);
  return rel;
}

const findClip = (id) => ['mp4', 'webm', 'mov', 'mkv'].map((e) => at('out/raw', `${id}.${e}`)).find((p) => fs.existsSync(p));

// Split narration into caption cues: max ~2 lines of ~42 chars, break on sentences first.
function cues(text, maxChars = 84) {
  const out = [];
  for (const sentence of String(text ?? '').trim().split(/(?<=[.!?])\s+/).filter(Boolean)) {
    let cur = '';
    for (const word of sentence.split(/\s+/)) {
      if (cur && (cur + ' ' + word).length > maxChars) {
        out.push(cur);
        cur = word;
      } else cur = cur ? cur + ' ' + word : word;
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** Old `zoom: {start_s, end_s, x, y, scale}` (or a list of them) → camera targets in clip seconds. */
function manualTargets(zoom) {
  const list = Array.isArray(zoom) ? zoom : [zoom];
  return list.flatMap((z) => {
    const s = z.scale ?? 1.5, x = z.x ?? 0.5, y = z.y ?? 0.5;
    const box = { x: x - 0.5 / s, y: y - 0.5 / s, w: 1 / s, h: 1 / s };
    return [
      { t: z.start_s, until: z.end_s, box, label: 'zoom' },
      { t: z.end_s, box: null, label: 'zoom-out' },
    ];
  });
}

/**
 * Everything about one recorded scene that does not depend on the window: duration, marks,
 * motion, key moment, camera targets (clip seconds).
 */
function analyze(s, clip) {
  const info = probe(clip);
  const side = fs.existsSync(at('out/raw', `${s.id}.json`)) ? JSON.parse(fs.readFileSync(at('out/raw', `${s.id}.json`), 'utf8')) : {};
  const motion = full ? null : motionFrames(clip, info.width, info.height);
  const act = motion ? L.activity(motion) : [];
  const auto = motion ? L.autoTargets(motion, act, { ignore: IGNORE }) : [];
  const lastS = Math.max(0, info.duration - 1 / info.fps);
  // Recorders that time marks by wall clock while a timer that slips under load writes the frames
  // produce clips shorter than their clock says, so marks land late. Snap each mark to the visual
  // change it refers to (timeline_lib.snapMarks).
  // A clip LONGER than the clock = the video started before the recorder's clock (a constant
  // lead-in, e.g. Playwright's screencast start-up): shift marks by it instead.
  const clockS = side.duration_s > 0 ? side.duration_s : info.duration;
  const leadS = info.duration > clockS + 0.05 ? info.duration - clockS : 0;
  const marks = L.snapMarks(Array.isArray(side.marks) ? side.marks : [], auto, leadS ? 1 : info.duration / clockS, leadS);
  if (info.duration < clockS * 0.98) {
    console.warn(`warn: ${s.id}: clip is ${info.duration.toFixed(2)}s but the recorder clock said ${clockS.toFixed(2)}s (frames dropped under load) - marks snapped to the screen changes; fix the recorder (references/vscode.md)`);
  }
  const keyMark = marks.filter((m) => m.label === 'key').pop();
  if (keyMark && side.key_moment_s != null) side.key_moment_s = keyMark.t;
  else if (side.key_moment_s != null) side.key_moment_s += leadS;

  // Popups the recorder saw on screen (menus, the palette and pickers, dialogs, completions,
  // hovers, toasts): they play at (near) real speed, and menus/pickers/dialogs are camera targets
  // so the viewer sees how an action was triggered, not only its result.
  const overlays = (Array.isArray(side.overlays) ? side.overlays : []).map((o) => ({ ...o, from: o.from + leadS, to: o.to + leadS }));
  let targets = [];
  if (s.zoom === false) targets = [];
  else if (s.zoom && s.zoom !== 'auto') targets = manualTargets(s.zoom);
  else if (marks.length || overlays.length) {
    for (const o of overlays) {
      if (['quick-input', 'menu', 'dialog'].includes(o.kind)) targets.push({ t: o.from + 0.1, until: o.to, box: o.box, label: o.kind });
    }
    for (const m of marks) {
      if (m.label === 'zoom-out') targets.push({ t: m.t, box: null, label: 'zoom-out' });
      else if (m.box) targets.push({ t: m.t, box: m.box, label: m.label === 'key' ? 'key' : m.label });
      else {
        const box = L.boxNear(auto, m.t);
        if (box) targets.push({ t: m.t, box, label: m.label === 'key' ? 'key' : m.label, derived: true });
      }
    }
  } else targets = auto;

  // Key moment: storyboard → recorder → the last boxed target inside the trim → near the end.
  const winStart = s.trim?.start_s ?? 0, winEnd = Math.min(s.trim?.end_s ?? info.duration, info.duration);
  let keyS = s.key_moment_at_s ?? side.key_moment_s;
  if (keyS == null) {
    const boxed = targets.filter((t) => t.box && t.t >= winStart && t.t <= winEnd - 0.5);
    keyS = boxed.length ? boxed[boxed.length - 1].t : Math.max(winStart, winEnd - 1.5);
  }
  keyS = Math.min(keyS, lastS);
  if (s.zoom !== false && !targets.some((t) => t.label === 'key')) {
    // Promote the target at (or just before) the key moment, else add one from motion.
    const near = targets.filter((t) => t.box && t.t <= keyS + 0.3 && t.t >= keyS - 2.5).pop();
    // Only boxes from the recorder are element boxes (focus ring); motion/manual boxes are not.
    if (near) Object.assign(near, { label: 'key', derived: near.derived || ['auto', 'zoom'].includes(near.label) });
    else {
      const box = L.boxNear(auto, keyS);
      if (box) targets.push({ t: keyS, box, label: 'key', derived: true });
    }
  }
  // Focus inside the key element: where the screen changed around the key moment (a wide key
  // element in 9:16 / 1:1 gets a push-in there).
  for (const t of targets.filter((x) => x.label === 'key' && x.box)) {
    const m = L.boxNear(auto, t.t);
    if (!m) continue;
    const x0 = Math.max(m.x, t.box.x), y0 = Math.max(m.y, t.box.y);
    const x1 = Math.min(m.x + m.w, t.box.x + t.box.w), y1 = Math.min(m.y + m.h, t.box.y + t.box.h);
    if (x1 > x0 && y1 > y0) t.focus = { x: +((x0 + x1) / 2).toFixed(4), y: +((y0 + y1) / 2).toFixed(4) };
  }
  targets.sort((a, b) => a.t - b.t);
  // A motion box right after a recorder mark adds nothing the mark did not frame (and is often
  // a whole panel that changed): drop it, so the camera does not pull back for it.
  targets = targets.filter((t, i) => !(t.derived && t.label !== 'key' && targets.slice(0, i).some((p) => !p.derived && p.box && t.t - p.t >= 0 && t.t - p.t < 1.5)));
  const idle = motion ? L.idleRuns(act, motion.fps) : [];
  const firstActive = motion ? (act.findIndex((a, i) => i > 0 && a > 3) / motion.fps) : 0;
  // The last thing the scene points at: the key moment, or a later mark (scenes often mark `key`
  // at the first aha and keep showing more).
  const lastEventS = Math.min(lastS, Math.max(keyS, ...marks.map((m) => m.t)));
  // Scenes sometimes tidy up after the result (Escape closes the popup, an undo): when the last
  // target's area changes after the final mark, the short ends there and holds the last good frame.
  const lastBox = targets.filter((t) => t.box && t.t <= lastEventS + 0.05).pop()?.box;
  const covered = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const tidy = lastBox && auto.find((c) => c.t > lastEventS + 0.1 && covered(c.box, lastBox) > 0.3 * lastBox.w * lastBox.h);
  return { info, marks, overlays, act, idle, targets, keyS, lastEventS, tailCutS: tidy ? tidy.t : null, lastS, firstActiveS: Math.max(0, firstActive) };
}

/**
 * Speed segments for a window: manual list and/or automatic speed-ups through idle stretches.
 * `baseRate` > 1 also plays everything else faster, except the moments a viewer must read at 1x:
 * the key moment, the final hold, a beat after every click (menus, pickers) and every labelled mark.
 */
function speedFor(s, a, start, end, baseRate = 1) {
  const spec = s.speed ?? 'auto';
  const list = Array.isArray(spec) ? spec : spec === false || full ? [] : ['auto'];
  const manual = list.filter((x) => x && typeof x === 'object');
  // Popups: never sped up. Menus, pickers and dialogs for as long as they are open (they are short
  // and are how an action is triggered); toasts, hovers and completions for their first moments
  // (they can linger while the scene moves on).
  const READ_S = { toast: 1.6, hover: 2.2, suggest: 1.6 };
  const held = a.overlays.map((o) => [o.from - 0.15, Math.min(o.to, o.from + (READ_S[o.kind] ?? Infinity)) + 0.3, o.kind]);
  const shown = held.map(([x, y]) => [x, y]);
  let segs = manual;
  if (list.includes('auto')) {
    const protect = [
      ...a.targets.filter((t) => t.box).map((t) => [t.t - 0.3, (t.until ?? t.t) + 0.3]),
      [a.keyS - 0.4, a.keyS + 1.5], // read the key moment at 1x
      [end - 1.2, end + 1], // and the final hold
      ...manual.map((m) => [m.from_s, m.to_s]),
      ...shown,
    ];
    const idle = a.idle.map((r) => ({ from_s: Math.max(r.from_s, start), to_s: Math.min(r.to_s, end) })).filter((r) => r.to_s > r.from_s);
    segs = [...manual, ...L.autoSpeed(idle, { protect, rate: style.idle_rate ?? 4 })];
  }
  if (baseRate > 1 && !full) {
    // Typing into the palette or a picker reads fine a little faster; every other popup at 1x.
    const typing = a.overlays
      .filter((o) => o.kind === 'quick-input' && !segs.some((m) => m.from_s < o.to && m.to_s > o.from))
      .map((o) => ({ from_s: o.from, to_s: o.to, rate: Math.min(baseRate, 1.4) }));
    segs = [...segs, ...typing];
    const marks = a.targets.filter((t) => !t.derived && t.label !== 'auto' && !['quick-input', 'menu', 'dialog'].includes(t.label));
    const protect = [
      [a.keyS - 0.3, a.keyS + 1.3],
      [end - 0.7, end + 1],
      // The cursor's glide to a click and the moment after it, so the viewer sees what was clicked.
      ...marks.map((t) => (t.label === 'click' ? [t.t - 0.5, t.t + 0.6] : [t.t - 0.1, t.t + 0.6])),
      ...held.filter(([, , kind]) => kind !== 'quick-input').map(([x, y]) => [x, y]),
      ...segs.map((m) => [m.from_s, m.to_s]),
    ];
    segs = [...segs, ...L.autoSpeed([{ from_s: start, to_s: end }], { protect, rate: baseRate, edge: 0, minS: 0.3 })];
  }
  return segs.sort((x, y) => x.from_s - y.from_s);
}

/** Width (0..1 of the frame) of the one-line caption pill, as Callout.tsx sizes it. */
function captionWidth(text, width) {
  const n = Math.max(1, String(text ?? '').length);
  const font = Math.min(width / 40, (width * 0.8) / (n * 0.52));
  return Math.min(0.84, (n * 0.55 * font + 1.6 * font) / width);
}

/** Plan one window of a clip: time map, key frame, targets in output frames, camera per layout. */
function plan(s, a, start, end, layouts, { holdS = 0, base = null, caption = '', baseRate = 1 } = {}) {
  const speed = speedFor(s, a, start, end, baseRate);
  const map = L.timeMap({ start, end, speed, holdS, lastFrameS: a.lastS + 1 / a.info.fps });
  const frames = map.length;
  const keyFrame = Math.max(0, L.outFrameAt(map, a.keyS));
  const targets = a.targets
    .map((t) => ({ f: L.outFrameAt(map, t.t), until: t.until != null ? L.outFrameAt(map, t.until) : undefined, box: t.box, label: t.label, ...(t.focus ? { focus: t.focus } : {}), ...(t.derived || t.label === 'auto' || t.label === 'zoom' ? { derived: true } : {}) }))
    .filter((t) => t.f >= 0)
    .map((t) => (t.until == null || t.until < 0 ? { ...t, until: undefined } : t));
  const srcAspect = a.info.width / a.info.height;
  const camera = {}, captionAt = {};
  for (const name of layouts) {
    const layout = L.LAYOUTS[name];
    const narrowBase = name === '16x9' ? null : base;
    camera[name] = s.zoom === false && !narrowBase
      ? [{ f: 0, ...L.fitFraming({ x: 0, y: 0, w: 1, h: 1 }, layout, L.baseCrop(layout, srcAspect)) }]
      : L.cameraPath(targets, { frames, layout, srcAspect, base: narrowBase });
    captionAt[name] = L.captionPlacement(targets, camera[name], layout, srcAspect, { width: captionWidth(caption, layout.width) });
  }
  return { map, frames, keyFrame, targets, camera, captionAt, speed: speed.map(({ from_s, to_s, rate }) => ({ from_s, to_s, rate })) };
}

const firstSentence = (t) => String(t ?? '').trim().split(/(?<=[.!?])\s+/)[0] ?? '';

// ---------------------------------------------------------------------------------------------
const scenes = [];
const shortAspects = style.shorts?.aspects ?? ['16x9', '9x16', '1x1'];
for (const s of board.scenes ?? []) {
  const clip = findClip(s.id);
  if (!clip) {
    const msg = `missing clip out/raw/${s.id}.(mp4|webm|mov|mkv)`;
    if (allowMissing) {
      console.warn(`warn: ${msg} - skipped`);
      continue;
    }
    throw new Error(msg);
  }
  const a = analyze(s, clip);
  const D = a.info.duration;
  const base = s.portrait_focus ? { x: s.portrait_focus.x ?? 0.5, y: s.portrait_focus.y ?? 0.5, s: s.portrait_focus.scale ?? 1.3 } : null;

  // Short window: storyboard trim, else skip a slow start and stop ~2.5 s after the last mark.
  const tStart = s.trim?.start_s ?? (a.firstActiveS > 0.75 ? a.firstActiveS - 0.4 : 0);
  const tEnd = Math.min(s.trim?.end_s ?? Math.min(D, a.lastEventS + 2.5, a.tailCutS ?? Infinity), D);
  const hold = a.lastEventS <= tEnd ? Math.max(0, 1.3 - (tEnd - a.lastEventS)) : 0;
  const short = plan(s, a, tStart, tEnd, ['16x9', '9x16', '1x1'], { holdS: hold, base, caption: s.caption ?? firstSentence(s.narration) });

  const ext = path.extname(clip);
  scenes.push({
    id: s.id,
    title: s.title ?? s.id,
    hook: s.hook ?? s.title ?? s.id,
    caption: s.caption ?? firstSentence(s.narration),
    narration: s.narration ?? '',
    clip: copyTo(clip, `clips/${s.id}${ext}`),
    clipFrames: Math.max(1, Math.floor(D * a.info.fps) - 1),
    srcAspect: +(a.info.width / a.info.height).toFixed(4),
    short: { ...short, from: HOOK_F - OVERLAP_F, total: HOOK_F - OVERLAP_F + short.frames - OVERLAP_F + END_F },
    _a: a,
    _s: s,
    _base: base,
    _max: s.max_duration_s,
  });
  const outS = sec(short.frames);
  if (outS > 20) console.warn(`warn: ${s.id} short clip is ${outS}s - add trim/speed in the storyboard (aim for 8-15 s)`);
}

// ---------------------------------------------------------------------------------------------
// Reel: highlighted scenes (all when none is marked), each trimmed to its best window.
const marked = scenes.some((x) => x._s.highlight != null && x._s.highlight !== false);
const reelScenes = scenes.filter((x) => (marked ? x._s.highlight != null && x._s.highlight !== false : true));
let cursor = f(INTRO_S);
const reel = [];
for (const x of reelScenes) {
  const { _a: a, _s: s } = x;
  const D = a.info.duration;
  let start = 0, end = D;
  if (!full) {
    // The whole action (as in the tour), played at REEL.rate outside the 1x moments - a window
    // around the key moment alone cuts off menus and results that come before or after it.
    const h = typeof s.highlight === 'object' ? s.highlight : null;
    start = h?.start_s ?? s.trim?.start_s ?? (a.firstActiveS > 0.75 ? a.firstActiveS - 0.4 : 0);
    end = Math.min(h?.end_s ?? s.trim?.end_s ?? Math.min(D, a.lastEventS + 1.1, a.tailCutS ?? Infinity), D);
  }
  const audioSrc = at('out/audio', `${s.id}.mp3`);
  const hasAudio = style.voiceover && fs.existsSync(audioSrc);
  const audioS = hasAudio ? probe(audioSrc).duration : 0;
  const chapter = `00  ${x.hook}`; // the 16:9 reel's callout text (number + hook)
  const rate = full ? 1 : REEL.rate;
  const p0 = plan(s, a, start, end, ['16x9', '9x16'], { base: x._base, caption: chapter, baseRate: rate });
  const needS = hasAudio ? VOICE_LEAD_S + audioS + VOICE_TAIL_S : 0;
  const p = needS > p0.frames / FPS ? plan(s, a, start, end, ['16x9', '9x16'], { base: x._base, caption: chapter, baseRate: rate, holdS: needS - p0.frames / FPS }) : p0;
  if (s.max_duration_s && p.frames / FPS > s.max_duration_s + 0.5) console.warn(`warn: ${s.id} is ${sec(p.frames)}s in the reel, over max_duration_s ${s.max_duration_s}`);

  // Captions: narration cues over the voiceover; else the one-line caption across the scene.
  const capStart = hasAudio ? VOICE_LEAD_S : 0.35;
  const capLen = hasAudio ? audioS : Math.max(1, p.frames / FPS - 0.6);
  const parts = hasAudio || !x.caption ? cues(s.narration) : [x.caption];
  const total = parts.reduce((n, c) => n + c.length, 0) || 1;
  let t = capStart;
  const captions = parts.map((text) => {
    const len = (capLen * text.length) / total;
    const cue = { text, from: f(t), to: f(t + len) };
    t += len;
    return cue;
  });
  reel.push({
    id: s.id,
    start: cursor,
    frames: p.frames,
    map: p.map,
    keyFrame: p.keyFrame,
    camera: p.camera,
    captionAt: p.captionAt,
    targets: p.targets,
    captions,
    audio: hasAudio ? copyTo(audioSrc, `audio/${s.id}.mp3`) : null,
    audioOffsetFrames: f(VOICE_LEAD_S),
  });
  cursor += p.frames;
}

// ---------------------------------------------------------------------------------------------
// Tour: EVERY scene in storyboard order - its whole action, from the first move to the result (the
// short's window, ending sooner after the last mark), played at TOUR.rate outside the moments that
// must be read at 1x - with a chapter card whenever the scene's `area` changes.
let tourCursor = f(INTRO_S);
const tourItems = [];
const areas = [...new Set(scenes.map((x) => x._s.area).filter(Boolean))];
let area = null;
for (const x of scenes) {
  const { _a: a, _s: s } = x;
  if (s.area && s.area !== area) {
    area = s.area;
    const frames = f(TOUR.chapter_s);
    tourItems.push({
      kind: 'chapter',
      title: area,
      n: areas.indexOf(area) + 1,
      of: areas.length,
      features: scenes.filter((y) => y._s.area === area).map((y) => y.hook),
      start: tourCursor,
      frames,
    });
    tourCursor += frames;
  }
  const D = a.info.duration;
  const start = full ? 0 : s.trim?.start_s ?? (a.firstActiveS > 0.75 ? a.firstActiveS - 0.4 : 0);
  const end = full ? D : Math.min(s.trim?.end_s ?? Math.min(D, a.lastEventS + 1.1, a.tailCutS ?? Infinity), D);
  const holdS = a.lastEventS <= end ? Math.max(0, 0.8 - (end - a.lastEventS)) : 0;
  const p = plan(s, a, start, end, ['16x9', '9x16'], { base: x._base, caption: x.hook, holdS, baseRate: TOUR.rate });
  tourItems.push({
    kind: 'scene', id: s.id, area: s.area ?? null, start: tourCursor, frames: p.frames, map: p.map, keyFrame: p.keyFrame,
    camera: p.camera, captionAt: p.captionAt, targets: p.targets, captions: [], audio: null, audioOffsetFrames: 0,
  });
  tourCursor += p.frames;
}

const media = (rel, name) => {
  if (!rel) return null;
  const src = at(rel);
  if (!fs.existsSync(src)) throw new Error(`file not found: ${rel}`);
  return copyTo(src, `${name}${path.extname(src)}`);
};

const brand = { primary: '#7C5CFF', secondary: null, accent: null, background: '#0B0B12', text: '#FFFFFF', ...(style.brand ?? {}) };
brand.secondary ??= brand.primary;
brand.accent ??= brand.secondary;
const timeline = {
  fps: FPS,
  product: { name: board.product?.name ?? '', tagline: board.product?.tagline ?? '', logo: media(board.product?.logo, 'logo') },
  brand,
  captions: { landscape: false, portrait: true, ...(style.captions ?? {}) },
  music: media(style.music, 'music'),
  musicVolume: style.music_volume ?? 0.35,
  layouts: L.LAYOUTS,
  cards: { hook: HOOK_F, end: END_F, overlap: OVERLAP_F },
  outro: { cta: board.outro?.cta ?? '', url: board.outro?.url ?? '', urlLabel: board.outro?.url_label ?? '', note: board.outro?.note ?? '', credit: board.outro?.credit ?? '' },
  scenes: scenes.map(({ _a, _s, _base, _max, ...rest }) => rest),
  reel: { intro: { frames: f(INTRO_S) }, scenes: reel, outro: { start: cursor, frames: f(OUTRO_S) }, totalFrames: cursor + f(OUTRO_S) },
  tour: { intro: { frames: f(INTRO_S) }, items: tourItems, outro: { start: tourCursor, frames: f(OUTRO_S) }, totalFrames: tourCursor + f(OUTRO_S) },
};
fs.writeFileSync(path.join(pub, 'timeline.json'), JSON.stringify(timeline) + '\n');

// Seconds-based check points for frame extraction (reel).
const R = timeline.reel;
const points = R.intro.frames ? [{ label: 'intro', t: sec(Math.round(R.intro.frames * 0.6)) }] : [];
for (const s of R.scenes) {
  points.push({ label: `${s.id}-start`, t: sec(s.start + Math.min(20, s.frames - 1)) });
  points.push({ label: `${s.id}-key`, t: sec(s.start + Math.min(s.keyFrame + f(0.4), s.frames - 1)) });
}
if (R.outro.frames) points.push({ label: 'outro', t: sec(R.outro.start + Math.round(R.outro.frames * 0.6)) });
fs.writeFileSync(
  at('out/final/timeline.json'),
  JSON.stringify({ duration_s: sec(R.totalFrames), points, scenes: R.scenes.map((s) => ({ id: s.id, start_s: sec(s.start), end_s: sec(s.start + s.frames), key_s: sec(s.start + s.keyFrame) })) }, null, 2) + '\n',
);

// Per-short check points: hook card, clip start, each camera target, key moment, end card.
for (const s of timeline.scenes) {
  const sh = s.short, from = sh.from;
  const pts = [{ label: 'hook', t: sec(Math.round(HOOK_F * 0.55)) }, { label: 'clip-start', t: sec(from + 12) }];
  for (const t of sh.targets.filter((t) => t.box && t.label !== 'key')) pts.push({ label: `target-${t.label.replace(/[^\w-]/g, '')}`, t: sec(from + Math.min(t.f + 4, sh.frames - 1)) });
  pts.push({ label: 'key', t: sec(from + Math.min(sh.keyFrame + f(0.5), sh.frames - 1)) });
  pts.push({ label: 'end-card', t: sec(sh.total - Math.round(END_F * 0.35)) });
  pts.sort((a, b) => a.t - b.t);
  fs.writeFileSync(
    at('out/final/shorts', `${s.id}.timeline.json`),
    JSON.stringify({ duration_s: sec(sh.total), points: pts, scenes: [{ id: s.id, start_s: sec(from), end_s: sec(from + sh.frames), key_s: sec(from + sh.keyFrame) }] }, null, 2) + '\n',
  );
}

// SRT sidecar (reel).
const ts = (fr) => {
  const ms = Math.round((fr / FPS) * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
let n = 0;
const srt = R.scenes.flatMap((s) => s.captions.map((c) => `${++n}\n${ts(s.start + c.from)} --> ${ts(s.start + c.to)}\n${c.text}\n`)).join('\n');
fs.writeFileSync(at('out/final/captions.srt'), srt);

console.log(`shorts: ${timeline.scenes.length}`);
for (const s of timeline.scenes) {
  const raw = scenes.find((x) => x.id === s.id)._a;
  const sped = s.short.speed.length ? `  ${s.short.speed.length} speed-up(s)` : '';
  console.log(`  ${s.id.padEnd(24)} ${sec(s.short.total).toString().padStart(5)}s (clip ${raw.info.duration.toFixed(1)}s → ${sec(s.short.frames)}s)  key @ ${sec(s.short.keyFrame)}s  ${s.short.targets.length} target(s)${sped}`);
}
console.log(`reel: ${R.scenes.length} scenes, ${sec(R.totalFrames)}s total${marked ? ' (highlight: scenes)' : ''}`);
console.log(`tour: ${tourItems.filter((t) => t.kind === 'scene').length} scenes in ${areas.length || 1} chapter(s), ${sec(timeline.tour.totalFrames)}s total`);
for (const s of R.scenes) console.log(`  ${s.id.padEnd(24)} ${sec(s.frames).toString().padStart(5)}s  key @ ${sec(s.keyFrame)}s${s.audio ? '  +voice' : ''}`);
if (sec(R.totalFrames) > (full ? 90 : REEL.max_s)) console.warn(`warn: reel is over ${full ? 90 : REEL.max_s}s - mark fewer scenes with highlight: true or tighten windows`);

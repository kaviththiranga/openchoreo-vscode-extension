// Edit logic behind build_timeline.mjs, kept free of I/O so tests/timeline.test.mjs can call it:
//   - time remapping: trim + speed ramps (manual and automatic through idle stretches)
//   - motion analysis on small grayscale frames: where did the screen change, and when
//   - the automatic camera: eased zoom/pan keyframes that frame each target box, per layout
//
// Units: clip time in seconds, output time in frames (FPS), boxes in 0..1 of the source frame.

export const FPS = 30;

/**
 * Output layouts. `panel` is where the clip is shown, in output pixels; the camera crops the
 * source to the panel's aspect. sMin/sMax bound the zoom (1 = the largest crop of the panel's
 * aspect that fits the source). sMin < 1 lets narrow layouts shrink the clip so a wide key
 * element is never cut off; other targets are framed at least at sTarget (readable on phones,
 * even if a wide box gets cropped). minBox (fraction of the source) is the smallest area the
 * camera frames around the key element / other targets, so it never zooms into a lone widget.
 */
export const LAYOUTS = {
  '16x9': { width: 1920, height: 1080, panel: { x: 0, y: 0, w: 1920, h: 1080 }, sMin: 1, sTarget: 1, sMax: 1.6, pad: 1.3, minBox: { key: 0.4, other: 0.58 } },
  '9x16': { width: 1080, height: 1920, panel: { x: 0, y: 540, w: 1080, h: 1260 }, sMin: 0.5, sTarget: 1.15, sMax: 1.6, pad: 1.12, minBox: { key: 0.2, other: 0.3 } },
  '1x1': { width: 1080, height: 1080, panel: { x: 0, y: 210, w: 1080, h: 870 }, sMin: 0.55, sTarget: 1.1, sMax: 1.7, pad: 1.15, minBox: { key: 0.24, other: 0.32 } },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

// ---------------------------------------------------------------------------------------------
// Time remapping

/** Clip-time rate function from speed segments, with linear ramps of ±ramp seconds at the edges. */
export function rateFn(speed = [], ramp = 0.18) {
  const segs = speed.filter((s) => s && s.to_s > s.from_s && s.rate > 0);
  const raw = (t) => {
    for (const s of segs) if (t >= s.from_s && t < s.to_s) return s.rate;
    return 1;
  };
  if (!segs.length) return () => 1;
  // Box-filter the step function: ramps instead of jumps (a "speed ramp").
  const N = 8;
  return (t) => {
    let sum = 0;
    for (let i = 0; i <= N; i++) sum += raw(t - ramp + (2 * ramp * i) / N);
    return sum / (N + 1);
  };
}

/**
 * Output frame → clip seconds, for a window [start, end) of the clip played with `speed`.
 * `holdS` repeats the last frame (a hold on the result). Returns an array, one entry per frame.
 */
export function timeMap({ start, end, speed = [], fps = FPS, holdS = 0, lastFrameS = end }) {
  const rate = rateFn(speed);
  const map = [];
  let t = start;
  const stop = Math.min(end, lastFrameS);
  while (t < stop - 1e-6 && map.length < 60 * 60 * fps) {
    map.push(round(t, 3));
    t += rate(t) / fps;
  }
  const last = map.length ? map[map.length - 1] : round(Math.max(0, stop - 1 / fps), 3);
  for (let i = 0; i < Math.round(holdS * fps); i++) map.push(last);
  return map;
}

/** First output frame showing clip time t (or a later one); -1 when t is outside the window. */
export function outFrameAt(map, t) {
  if (!map.length || t < map[0] - 0.05 || t > map[map.length - 1] + 0.05) return -1;
  for (let i = 0; i < map.length; i++) if (map[i] >= t - 1e-3) return i;
  return map.length - 1;
}

// ---------------------------------------------------------------------------------------------
// Motion analysis. `frames` = { w, h, fps, data: Uint8Array[] } of grayscale frames.

const DIFF = 22; // gray-level change that counts as "changed"

/** Changed-pixel count between consecutive frames: activity[i] compares frame i-1 → i. */
export function activity(frames) {
  const { data, w, h } = frames;
  const out = [0];
  for (let i = 1; i < data.length; i++) {
    const a = data[i - 1], b = data[i];
    let c = 0;
    for (let p = 0; p < w * h; p++) if (Math.abs(a[p] - b[p]) > DIFF) c++;
    out.push(c);
  }
  return out;
}

/** Stretches where nothing on screen changes for at least minS seconds: [{from_s, to_s}]. */
export function idleRuns(act, fps, { maxPixels = 3, minS = 0.8 } = {}) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= act.length; i++) {
    const idle = i < act.length && act[i] <= maxPixels;
    if (idle && start < 0) start = i;
    if (!idle && start >= 0) {
      if ((i - start) / fps >= minS) runs.push({ from_s: round(start / fps, 2), to_s: round(i / fps, 2) });
      start = -1;
    }
  }
  return runs;
}

/** Bursts of change (actions and their results): [{from_s, to_s, peak}]; small gaps are bridged. */
export function bursts(act, fps, { minPixels = 12, gapS = 0.35 } = {}) {
  const out = [];
  let cur = null;
  for (let i = 0; i < act.length; i++) {
    if (act[i] < minPixels) continue;
    const t = i / fps;
    if (cur && t - cur.to_s <= gapS) {
      cur.to_s = t;
      cur.peak = Math.max(cur.peak, act[i]);
    } else {
      if (cur) out.push(cur);
      cur = { from_s: t, to_s: t, peak: act[i] };
    }
  }
  if (cur) out.push(cur);
  return out.map((b) => ({ ...b, from_s: round(Math.max(0, b.from_s - 1 / fps), 2), to_s: round(b.to_s, 2) }));
}

const inZones = (x, y, zones) => zones.some(([zx, zy, zw, zh]) => x >= zx && x < zx + zw && y >= zy && y < zy + zh);

/**
 * Box (0..1) around the main region that differs between two frames, or null. Changed pixels are
 * grouped on a coarse grid; the largest connected group wins (a cursor blip or a keycast pill
 * elsewhere does not drag the box across the screen). `ignore` = [[x,y,w,h], ...] in 0..1.
 */
export function changeBox(a, b, w, h, { cell = 4, minPixels = 14, ignore = [] } = {}) {
  const dimmed = dimmedBox(a, b, w, h, cell);
  if (dimmed !== undefined) return dimmed;
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const counts = new Int32Array(gw * gh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (Math.abs(a[p] - b[p]) <= DIFF) continue;
      if (ignore.length && inZones(x / w, y / h, ignore)) continue;
      counts[Math.floor(y / cell) * gw + Math.floor(x / cell)]++;
    }
  }
  // Connected components over cells (8-neighbourhood, bridging a one-cell gap).
  const seen = new Uint8Array(gw * gh);
  let best = null;
  for (let s = 0; s < counts.length; s++) {
    if (!counts[s] || seen[s]) continue;
    const stack = [s];
    seen[s] = 1;
    let px = 0, x0 = gw, y0 = gh, x1 = -1, y1 = -1;
    while (stack.length) {
      const c = stack.pop();
      const cx = c % gw, cy = (c - cx) / gw;
      px += counts[c];
      x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const n = ny * gw + nx;
          if (counts[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
        }
      }
    }
    if (px >= minPixels && (!best || px > best.px)) best = { px, x0, y0, x1, y1 };
  }
  if (!best) return null;
  const x = (best.x0 * cell) / w, y = (best.y0 * cell) / h;
  const bw = ((best.x1 + 1) * cell) / w - x, bh = ((best.y1 + 1) * cell) / h - y;
  return { x: round(x), y: round(y), w: round(Math.min(1 - x, bw)), h: round(Math.min(1 - y, bh)), px: best.px };
}

/**
 * A modal dialog dims everything behind it, so "what changed" is the whole frame. When most
 * pixels got darker, the dialog is the largest floating region that did NOT get darker.
 * Returns undefined when the frame was not dimmed, null when dimmed but no dialog was found.
 */
export function dimmedBox(a, b, w, h, cell = 4) {
  let dark = 0;
  for (let p = 0; p < w * h; p++) if (b[p] - a[p] < -6) dark++;
  if (dark < 0.45 * w * h) return undefined;
  const gw = Math.floor(w / cell), gh = Math.floor(h / cell);
  const on = new Uint8Array(gw * gh);
  for (let cy = 0; cy < gh; cy++) {
    for (let cx = 0; cx < gw; cx++) {
      let keep = 0;
      for (let y = cy * cell; y < (cy + 1) * cell; y++) for (let x = cx * cell; x < (cx + 1) * cell; x++) if (b[y * w + x] - a[y * w + x] >= -6) keep++;
      on[cy * gw + cx] = keep >= 0.7 * cell * cell ? 1 : 0;
    }
  }
  const seen = new Uint8Array(gw * gh);
  let best = null;
  for (let s = 0; s < on.length; s++) {
    if (!on[s] || seen[s]) continue;
    const stack = [s];
    seen[s] = 1;
    let n = 0, x0 = gw, y0 = gh, x1 = -1, y1 = -1;
    while (stack.length) {
      const c = stack.pop();
      const cx = c % gw, cy = (c - cx) / gw;
      n++;
      x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const m = ny * gw + nx;
        if (on[m] && !seen[m]) { seen[m] = 1; stack.push(m); }
      }
    }
    const floating = x0 > 0 && y0 > 0 && x1 < gw - 1 && y1 < gh - 1;
    if (floating && n >= 6 && (!best || n > best.n)) best = { n, x0, y0, x1, y1 };
  }
  if (!best) return null;
  const x = (best.x0 * cell) / w, y = (best.y0 * cell) / h;
  return { x: round(x), y: round(y), w: round(((best.x1 + 1) * cell) / w - x), h: round(((best.y1 + 1) * cell) / h - y), px: best.n * cell * cell };
}

/** Index of the motion frame nearest to t seconds. */
const frameIdx = (frames, t) => clamp(Math.round(t * frames.fps), 0, frames.data.length - 1);

/**
 * Camera targets from motion alone: one per burst of change with a visible box. Tiny changes
 * (a cursor blip, a keycast pill) are dropped by minPixels.
 */
export function autoTargets(frames, act, { ignore = [], minArea = 0.002, minPixels = 30 } = {}) {
  const out = [];
  for (const bu of bursts(act, frames.fps)) {
    const a = frames.data[frameIdx(frames, bu.from_s - 0.1)];
    const b = frames.data[frameIdx(frames, bu.to_s + 0.2)];
    const box = changeBox(a, b, frames.w, frames.h, { ignore, minPixels });
    if (!box || box.w * box.h < minArea) continue;
    out.push({ t: bu.from_s, until: bu.to_s, box: { x: box.x, y: box.y, w: box.w, h: box.h }, label: 'auto', px: box.px });
  }
  return out;
}

/**
 * The box a mark without one refers to: what changed in the latest burst that started up to
 * `lookbackS` before the mark (recorders mark a result after it appeared, e.g. before a screenshot).
 */
export function boxNear(auto, t, { lookbackS = 2.5, afterS = 0.2 } = {}) {
  const hits = auto.filter((a) => a.t <= t + afterS && a.until >= t - lookbackS);
  return hits.length ? hits[hits.length - 1].box : null;
}

const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Put marks on the clip's own timeline. `ratio` = clip length / the recorder's clock; below 1 the
 * recorder dropped frames, so a mark's true time lies in [t * ratio, t]. A mark with a box snaps
 * to the burst of change inside that window that overlaps its box most (a clicked row lights up,
 * a dialog appears). Others (screenshots) go to the calm stretch inside the window. With an exact clock (ratio 1) marks only
 * snap within ±0.3 s. `leadS` shifts every mark first (a recorder whose video starts before its
 * clock). Returns new marks; the original time is kept as `t_recorded`.
 */
export function snapMarks(marks, auto, ratio = 1, leadS = 0) {
  const r = Math.min(1, ratio);
  return marks.map((m0) => {
    const m = { ...m0, t: m0.t + leadS };
    const lo = m.t * r - 0.3, hi = m.t + 0.3;
    let best = null, bestScore = 0.2;
    if (m.box) {
      const area = Math.max(1e-6, m.box.w * m.box.h);
      for (const a of auto) {
        if (a.t < lo || a.t > hi) continue;
        const score = overlapArea(a.box, m.box) / Math.min(area, a.box.w * a.box.h) - Math.abs(a.t - m.t) * 0.01;
        if (score > bestScore) { best = a; bestScore = score; }
      }
    }
    let t = best ? best.t : m.t;
    if (!m.box && r < 1) {
      // No box (a screenshot): it was taken while the screen was still - the calm stretch
      // between two bursts that overlaps the window most.
      t = (m.t * (1 + r)) / 2;
      let most = 0;
      for (let i = 0; i <= auto.length; i++) {
        const a = i ? auto[i - 1].until : 0, b = i < auto.length ? auto[i].t : Infinity;
        const o0 = Math.max(a, m.t * r), o1 = Math.min(b, m.t);
        if (o1 - o0 > most) { most = o1 - o0; t = (o0 + o1) / 2; }
      }
    }
    return { ...m, t: round(t, 2), ...(t !== m0.t ? { t_recorded: m0.t } : {}) };
  });
}

/** Speed-ups through idle stretches, keeping ±edge seconds at 1x and never touching `protect`. */
export function autoSpeed(idle, { rate = 4, edge = 0.25, minS = 0.5, protect = [] } = {}) {
  const out = [];
  for (const r of idle) {
    let pieces = [[r.from_s + edge, r.to_s - edge]];
    for (const [pa, pb] of protect) {
      pieces = pieces.flatMap(([a, b]) => {
        if (pb <= a || pa >= b) return [[a, b]];
        return [[a, pa], [pb, b]].filter(([x, y]) => y > x);
      });
    }
    for (const [a, b] of pieces) if (b - a >= minS) out.push({ from_s: round(a, 2), to_s: round(b, 2), rate, auto: true });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Camera

/** The scale-1 crop of a layout's panel aspect inside a source of aspect srcAspect (0..1 units). */
export function baseCrop(layout, srcAspect) {
  const a = layout.panel.w / layout.panel.h;
  return a < srcAspect ? { cw: a / srcAspect, ch: 1 } : { cw: 1, ch: srcAspect / a };
}

/** Keep the crop inside the source (when it is smaller than the source in that axis). */
export function clampFraming(fr, crop) {
  // Round first, then clamp inward, so rounding never pushes the crop past the frame's edge.
  const s = round(fr.s, 3);
  const cw = crop.cw / s, ch = crop.ch / s;
  const inside = (v, half) => clamp(round(v), Math.ceil(half * 1e4) / 1e4, Math.floor((1 - half) * 1e4) / 1e4);
  const x = cw >= 1 ? 0.5 : inside(fr.x, cw / 2);
  const y = ch >= 1 ? 0.5 : inside(fr.y, ch / 2);
  return { x, y, s };
}

/**
 * Framing that shows the whole box with padding, as zoomed in as the layout allows. `whole`
 * (the key element, a zoom-out) may shrink to sMin to keep it all in view; other targets stay
 * at sTarget or closer.
 */
export function fitFraming(box, layout, crop, whole = true) {
  // Small targets (a button, a menu item) keep some context around them: a click gets a gentle
  // push, not a punch into one widget; the key element may come closer.
  const min = layout.minBox?.[whole ? 'key' : 'other'] ?? 0;
  const w = Math.max(box.w, min), h = Math.max(box.h, min);
  box = { x: box.x + box.w / 2 - w / 2, y: box.y + box.h / 2 - h / 2, w, h };
  const fit = Math.min(crop.cw / (box.w * layout.pad), crop.ch / (box.h * layout.pad));
  let s = clamp(fit, whole ? layout.sMin : (layout.sTarget ?? layout.sMin), layout.sMax);
  if (layout.sMin >= 1 && s < 1.15) s = 1; // a 10% zoom only softens the picture
  return clampFraming({ x: box.x + box.w / 2, y: box.y + box.h / 2, s }, crop);
}

const union = (a, b) => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
const similar = (a, b) => Math.abs(a.x - b.x) < 0.06 && Math.abs(a.y - b.y) < 0.06 && Math.abs(Math.log(a.s / b.s)) < 0.12;

/**
 * Camera keyframes [{f, x, y, s}] for one layout. Interpolate between consecutive keyframes
 * with an ease-in-out (the Remotion side does that); equal neighbours are a hold.
 *
 * targets: [{f, until?, box, label}] in output frames (box null = wide shot).
 * Rules: a short wide establishing shot, then the camera arrives ~LEAD frames before each target
 * and holds; targets closer than MERGE frames are framed together; a long move between two
 * zoomed-in spots pulls back halfway; after the last target the camera holds to the end.
 */
export function cameraPath(targets, { frames, layout, srcAspect, base = null }) {
  const LEAD = 5, MOVE = 18, MIN_MOVE = 9, MIN_HOLD = 14, MERGE = 20, REVEAL = 24;
  const crop = baseCrop(layout, srcAspect);
  const full = { x: 0, y: 0, w: 1, h: 1 };
  const sorted = targets.filter((t) => t.f >= 0 && t.f < frames).sort((a, b) => a.f - b.f);

  // Merge targets that come too fast to visit one by one.
  const merged = [];
  for (const t of sorted) {
    const prev = merged[merged.length - 1];
    const box = t.box ?? full;
    if (prev && t.f - (prev.until ?? prev.f) < MERGE) {
      prev.box = union(prev.box, box);
      prev.until = Math.max(prev.until ?? prev.f, t.until ?? t.f);
      if (t.label === 'key') Object.assign(prev, { label: 'key', focus: t.focus ?? prev.focus });
    } else merged.push({ ...t, box });
  }

  const wide = fitFraming(full, layout, crop);
  let start = base ? clampFraming(base, crop) : wide;
  if (!base && layout.sMin < 1 && merged.length) {
    // Narrow layouts open on a scale-1 crop centred on where the first action happens.
    const first = merged[0].box;
    start = clampFraming({ x: first.x + first.w / 2, y: first.y + first.h / 2, s: 1 }, crop);
  }
  const keys = [{ f: 0, ...start }];
  let cur = start;
  let free = Math.min(12, Math.max(0, (merged[0]?.f ?? 0) - LEAD - MOVE)); // establishing shot

  for (const t of merged) {
    const fr = fitFraming(t.box, layout, crop, t.label === 'key' || t.label === 'zoom-out');
    if (!similar(fr, cur)) {
      let arrive = Math.max(free + MIN_MOVE, t.f - LEAD);
      const moveStart = Math.max(free, arrive - MOVE);
      arrive = Math.max(arrive, moveStart + MIN_MOVE);
      if (arrive >= frames) break;
      keys.push({ f: moveStart, ...cur });
      const far = Math.hypot(fr.x - cur.x, fr.y - cur.y) > 0.3 && Math.min(fr.s, cur.s) > 1.25;
      if (far && arrive - moveStart >= 16) {
        const mid = clampFraming({ x: (fr.x + cur.x) / 2, y: (fr.y + cur.y) / 2, s: Math.max(layout.sMin, Math.min(fr.s, cur.s) * 0.8) }, crop);
        keys.push({ f: Math.round((moveStart + arrive) / 2), ...mid });
      }
      keys.push({ f: arrive, ...fr });
      cur = fr;
      free = Math.max(arrive, t.until ?? t.f) + MIN_HOLD;
      // A key element too wide for a narrow layout: reveal it whole, then push in - to the start
      // of a text line/row, or to where the screen changed inside a panel (`focus`) - so it is
      // readable on a phone.
      const target = layout.sTarget ?? 1;
      if (t.label === 'key' && fr.s < target && arrive + REVEAL + MOVE < frames - 12) {
        const b = t.box;
        const s = Math.min(layout.sMax, target * 1.15);
        const cw = crop.cw / s;
        const line = b.h < 0.12; // a text line or a row: read it from its start
        const fx = line ? b.x + cw / 2 - 0.02 : (t.focus?.x ?? b.x + b.w / 2);
        const fy = line ? b.y + b.h / 2 : (t.focus?.y ?? b.y + b.h / 2);
        const push = clampFraming({ x: fx, y: fy, s }, crop);
        keys.push({ f: arrive + REVEAL, ...fr }, { f: arrive + REVEAL + MOVE, ...push });
        cur = push;
        free = arrive + REVEAL + MOVE + MIN_HOLD;
      }
    } else {
      free = Math.max(free, (t.until ?? t.f) + MIN_HOLD);
    }
  }
  keys.push({ f: frames - 1, ...cur });
  // Drop keyframes that would go backwards in time (very short clips).
  return keys.filter((k, i) => i === 0 || k.f > keys[i - 1].f || i === keys.length - 1).map((k) => ({ ...k, f: Math.max(0, k.f) }));
}

const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/** Camera framing at output frame f (same math as video/src/lib/camera.ts). */
export function cameraAt(keys, f) {
  if (!keys.length) return { x: 0.5, y: 0.5, s: 1 };
  if (f <= keys[0].f) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    if (f <= b.f) {
      const p = b.f === a.f ? 1 : easeInOut((f - a.f) / (b.f - a.f));
      return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, s: Math.exp(Math.log(a.s) + (Math.log(b.s) - Math.log(a.s)) * p) };
    }
  }
  return keys[keys.length - 1];
}

/** Where a source box lands in the panel (0..1 of the panel) under a framing. */
export function screenBox(box, fr, crop) {
  const cw = crop.cw / fr.s, ch = crop.ch / fr.s;
  const x0 = fr.x - cw / 2, y0 = fr.y - ch / 2;
  return { x: (box.x - x0) / cw, y: (box.y - y0) / ch, w: box.w / cw, h: box.h / ch };
}

/** Where an overlay caption can go, in 0..1 of the panel; `width` = the one-line caption's width. */
export function captionSlots(width = 0.7) {
  const w = Math.min(0.84, width), side = 0.46, m = 0.035, h1 = 0.09, h2 = 0.16;
  return {
    'bottom-center': { x: 0.5 - w / 2, y: 1 - m - h1, w, h: h1 },
    'top-center': { x: 0.5 - w / 2, y: m, w, h: h1 },
    'bottom-right': { x: 1 - m - side, y: 1 - m - h2, w: side, h: h2 },
    'bottom-left': { x: m, y: 1 - m - h2, w: side, h: h2 },
    'top-right': { x: 1 - m - side, y: m, w: side, h: h2 },
    'top-left': { x: m, y: m, w: side, h: h2 },
  };
}

/**
 * Put an overlay caption where it covers the action least: each target's on-screen box (under
 * the camera, shortly after it is reached and while it holds) against six slots; the key target
 * counts triple. Ties go to the earlier slot (bottom-center first). Returns e.g. 'bottom-right'.
 */
export function captionPlacement(targets, keys, layout, srcAspect, { width = 0.7 } = {}) {
  const crop = baseCrop(layout, srcAspect);
  const slots = captionSlots(width);
  const cost = Object.fromEntries(Object.keys(slots).map((k) => [k, 0]));
  const area = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  for (const t of targets) {
    if (!t.box || t.f < 0) continue;
    const weight = t.label === 'key' ? 3 : 1;
    for (const df of [6, 30]) {
      const sb = screenBox(t.box, cameraAt(keys, t.f + df), crop);
      for (const [k, r] of Object.entries(slots)) cost[k] += weight * area(sb, r);
    }
  }
  let best = 'bottom-center';
  for (const k of Object.keys(slots)) if (cost[k] < cost[best] - 1e-4) best = k;
  return best;
}

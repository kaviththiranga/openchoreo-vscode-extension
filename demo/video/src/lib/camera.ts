// Camera math shared by every composition (same as scripts/tools/timeline_lib.mjs).
import type { CameraKey, Layout } from '../types';

export type Crop = { cw: number; ch: number };

/** The scale-1 crop of the panel's aspect inside the source, in 0..1 of the source. */
export const baseCrop = (layout: Layout, srcAspect: number): Crop => {
  const a = layout.panel.w / layout.panel.h;
  return a < srcAspect ? { cw: a / srcAspect, ch: 1 } : { cw: 1, ch: srcAspect / a };
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/** Framing at frame f: eased between keyframes, scale interpolated in log space, kept in frame. */
export function cameraAt(keys: CameraKey[] | undefined, f: number, crop: Crop) {
  let fr = { x: 0.5, y: 0.5, s: 1 };
  if (keys?.length) {
    fr = keys[keys.length - 1];
    if (f <= keys[0].f) fr = keys[0];
    else
      for (let i = 1; i < keys.length; i++) {
        const a = keys[i - 1], b = keys[i];
        if (f <= b.f) {
          const p = b.f === a.f ? 1 : easeInOut((f - a.f) / (b.f - a.f));
          fr = { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, s: Math.exp(Math.log(a.s) + (Math.log(b.s) - Math.log(a.s)) * p) };
          break;
        }
      }
  }
  const cw = crop.cw / fr.s, ch = crop.ch / fr.s;
  return {
    s: fr.s,
    x: cw >= 1 ? 0.5 : clamp(fr.x, cw / 2, 1 - cw / 2),
    y: ch >= 1 ? 0.5 : clamp(fr.y, ch / 2, 1 - ch / 2),
    cw,
    ch,
  };
}

/** Fit a long hook/caption: shrink the font until it fits in `lines` lines of `width` px. */
export const fitFont = (text: string, base: number, width: number, lines: number, charEm = 0.56) =>
  Math.round(Math.min(base, (width * lines) / (Math.max(1, text.length) * charEm)));

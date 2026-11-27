import { interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { baseCrop, cameraAt } from '../lib/camera';
import type { Brand, Layout, LayoutName, Plan, Scene } from '../types';

const clampX = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/**
 * The recorded clip inside a panel of the layout: time-remapped through `plan.map` (trim + speed
 * ramps) and framed by the camera keyframes for this layout. Click marks get a ripple, the key
 * element a soft focus ring. `at` freezes everything at one frame (posters, loop crossfades).
 */
export const Stage: React.FC<{
  scene: Scene;
  plan: Plan;
  layout: LayoutName;
  layouts: Record<LayoutName, Layout>;
  brand: Brand;
  at?: number;
  rings?: boolean;
}> = ({ scene, plan, layout, layouts, brand, at, rings = true }) => {
  const now = useCurrentFrame();
  const { fps } = useVideoConfig();
  const f = Math.max(0, Math.min(at ?? now, plan.map.length - 1));
  const L = layouts[layout];
  const { w: pw, h: ph } = L.panel;
  const crop = baseCrop(L, scene.srcAspect);
  const cam = cameraAt(plan.camera[layout], f, crop);

  // Rendered video size and offset so the crop (cw x ch around x,y) fills the panel.
  const vw = pw / cam.cw;
  const vh = vw / scene.srcAspect;
  const left = pw / 2 - cam.x * vw;
  const top = ph / 2 - cam.y * vh;
  const inset = vw < pw - 1 || vh < ph - 1; // the clip is smaller than the panel: frame it as a card
  const clipFrame = Math.min(scene.clipFrames, Math.round(plan.map[f] * fps));
  const toPanel = (bx: number, by: number) => ({ x: left + bx * vw, y: top + by * vh });

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          width: vw,
          height: vh,
          transform: `translate(${left}px, ${top}px)`,
          borderRadius: inset ? 18 : 0,
          overflow: 'hidden',
          boxShadow: inset ? '0 24px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08)' : 'none',
        }}
      >
        {/* Time remap: a Sequence shifted so the video sees `clipFrame`. (<Freeze> would clamp
            to the composition length, so it cannot reach late parts of a long clip.) */}
        <Sequence from={now - clipFrame} layout="none">
          <OffthreadVideo src={staticFile(scene.clip)} muted style={{ width: '100%', height: '100%', display: 'block' }} />
        </Sequence>
      </div>
      {rings &&
        plan.targets.map((t, i) => {
          if (!t.box) return null;
          const d = f - t.f;
          if (t.label === 'click' && d >= 0 && d < 16) {
            const c = toPanel(t.box.x + t.box.w / 2, t.box.y + t.box.h / 2);
            const r = interpolate(d, [0, 15], [10, 70], clampX);
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: c.x - r,
                  top: c.y - r,
                  width: r * 2,
                  height: r * 2,
                  borderRadius: '50%',
                  border: `4px solid ${brand.accent}`,
                  opacity: interpolate(d, [0, 15], [0.9, 0], clampX),
                }}
              />
            );
          }
          if (t.label === 'key' && !t.derived && t.box.w * t.box.h < 0.35 && d >= 0 && d < 50) {
            const p = spring({ frame: d, fps, config: { damping: 16, stiffness: 180 } });
            const a = toPanel(t.box.x, t.box.y);
            const b = toPanel(t.box.x + t.box.w, t.box.y + t.box.h);
            const pad = 10 + (1 - p) * 26;
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: a.x - pad,
                  top: a.y - pad,
                  width: b.x - a.x + pad * 2,
                  height: b.y - a.y + pad * 2,
                  borderRadius: 14,
                  border: `4px solid ${brand.accent}`,
                  boxShadow: `0 0 0 9999px rgba(0,0,0,${0.28 * p * interpolate(d, [34, 50], [1, 0], clampX)}), 0 0 32px ${brand.accent}`,
                  opacity: p * interpolate(d, [34, 50], [1, 0], clampX),
                }}
              />
            );
          }
          return null;
        })}
    </div>
  );
};

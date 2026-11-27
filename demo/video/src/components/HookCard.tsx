import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { fitFont } from '../lib/camera';
import type { LayoutName, Timeline } from '../types';
import { Backdrop } from './Backdrop';
import { Brandmark } from './Brandmark';

const SIZE: Record<LayoutName, { font: number; width: number; lines: number; mark: number }> = {
  '16x9': { font: 150, width: 1560, lines: 2, mark: 40 },
  '9x16': { font: 132, width: 900, lines: 4, mark: 44 },
  '1x1': { font: 118, width: 920, lines: 3, mark: 38 },
};

/** ~1 s kinetic title: the hook pops in word by word on the brand gradient, then zooms away. */
export const HookCard: React.FC<{ text: string; timeline: Timeline; layout: LayoutName }> = ({ text, timeline, layout }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const sz = SIZE[layout];
  const words = text.split(/\s+/).filter(Boolean);
  const exit = interpolate(frame, [durationInFrames - timeline.cards.overlap, durationInFrames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const mark = spring({ frame, fps, config: { damping: 200 } });
  const font = fitFont(text, sz.font, sz.width, sz.lines);

  return (
    <AbsoluteFill style={{ opacity: 1 - exit, transform: `scale(${1 + exit * 0.12})` }}>
      <Backdrop brand={timeline.brand} vivid />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: 60 }}>
        <div style={{ opacity: mark, transform: `translateY(${(1 - mark) * -16}px)`, marginBottom: font * 0.32 }}>
          <Brandmark timeline={timeline} size={sz.mark} />
        </div>
        <div style={{ maxWidth: sz.width, textAlign: 'center', textWrap: 'balance', lineHeight: 1.02, fontSize: font, fontWeight: 800, letterSpacing: -font * 0.03, color: '#fff' }}>
          {words.map((w, i) => {
            const p = spring({ frame: frame - 2 - i * 3, fps, config: { damping: 14, stiffness: 220, mass: 0.6 } });
            return (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  marginRight: i < words.length - 1 ? '0.24em' : 0,
                  opacity: Math.min(1, p * 1.4),
                  transform: `translateY(${(1 - p) * 0.45 * font}px) scale(${0.85 + 0.15 * p})`,
                  textShadow: '0 6px 30px rgba(0,0,0,.25)',
                }}
              >
                {w}
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

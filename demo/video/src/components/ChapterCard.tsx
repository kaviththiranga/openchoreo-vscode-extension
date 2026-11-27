import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { fitFont } from '../lib/camera';
import type { LayoutName, Timeline, TourChapter } from '../types';
import { Backdrop } from './Backdrop';

const SIZE: Record<LayoutName, { title: number; width: number; pill: number }> = {
  '16x9': { title: 132, width: 1640, pill: 30 },
  '9x16': { title: 112, width: 940, pill: 30 },
  '1x1': { title: 96, width: 960, pill: 24 },
};

/**
 * Tour chapter: the area's number slides in, its title springs up, then the features it holds
 * pop in one by one as pills - a table of contents that also tells the viewer what comes next.
 */
export const ChapterCard: React.FC<{ chapter: TourChapter; timeline: Timeline; layout: LayoutName }> = ({ chapter, timeline, layout }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const sz = SIZE[layout];
  const { brand } = timeline;
  const exit = interpolate(frame, [durationInFrames - timeline.cards.overlap, durationInFrames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const num = spring({ frame, fps, config: { damping: 18, stiffness: 160 } });
  const title = spring({ frame: frame - 3, fps, config: { damping: 13, stiffness: 190, mass: 0.7 } });
  const font = fitFont(chapter.title, sz.title, sz.width, 2);
  const stagger = Math.max(1, Math.min(3, Math.floor((durationInFrames - 22) / Math.max(1, chapter.features.length))));

  return (
    <AbsoluteFill style={{ opacity: 1 - exit, transform: `scale(${1 + exit * 0.08})` }}>
      <Backdrop brand={brand} vivid />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: 70, gap: 26 }}>
        <div
          style={{
            fontSize: sz.pill * 1.05, fontWeight: 800, letterSpacing: 4, color: '#fff', opacity: 0.85 * num,
            transform: `translateX(${(1 - num) * -60}px)`, fontVariantNumeric: 'tabular-nums',
          }}
        >
          {String(chapter.n).padStart(2, '0')} <span style={{ opacity: 0.55 }}>/ {String(chapter.of).padStart(2, '0')}</span>
        </div>
        <div
          style={{
            fontSize: font, fontWeight: 800, lineHeight: 1.02, letterSpacing: -font * 0.03, color: '#fff', textAlign: 'center',
            maxWidth: sz.width, textWrap: 'balance', opacity: Math.min(1, title * 1.3),
            transform: `translateY(${(1 - title) * font * 0.4}px) scale(${0.9 + 0.1 * title})`, textShadow: '0 8px 36px rgba(0,0,0,.28)',
          }}
        >
          {chapter.title}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12, maxWidth: sz.width, marginTop: 10 }}>
          {chapter.features.map((f, i) => {
            const p = spring({ frame: frame - 9 - i * stagger, fps, config: { damping: 15, stiffness: 240, mass: 0.5 } });
            return (
              <div
                key={i}
                style={{
                  fontSize: sz.pill, fontWeight: 650, color: '#fff', padding: `${sz.pill * 0.32}px ${sz.pill * 0.7}px`,
                  borderRadius: sz.pill, background: 'rgba(5,10,30,.38)', border: '1px solid rgba(255,255,255,.22)',
                  opacity: Math.min(1, p * 1.5), transform: `translateY(${(1 - p) * 24}px) scale(${0.92 + 0.08 * p})`,
                }}
              >
                {f}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

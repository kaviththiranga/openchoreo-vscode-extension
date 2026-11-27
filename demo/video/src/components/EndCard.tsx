import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { fitFont } from '../lib/camera';
import type { LayoutName, Timeline } from '../types';
import { Backdrop } from './Backdrop';
import { Brandmark } from './Brandmark';

const SIZE: Record<LayoutName, { name: number; cta: number; url: number; width: number; mark: number }> = {
  '16x9': { name: 96, cta: 46, url: 32, width: 1500, mark: 54 },
  '9x16': { name: 92, cta: 46, url: 32, width: 940, mark: 50 },
  '1x1': { name: 80, cta: 40, url: 28, width: 960, mark: 44 },
};

/** Product, call to action and URL. Fades in over the end of the clip. */
export const EndCard: React.FC<{ timeline: Timeline; layout: LayoutName; tagline?: boolean }> = ({ timeline, layout, tagline = true }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sz = SIZE[layout];
  const { product, outro, brand } = timeline;
  const fade = interpolate(frame, [0, timeline.cards.overlap], [0, 1], { extrapolateRight: 'clamp' });
  const pop = spring({ frame: frame - 2, fps, config: { damping: 15, stiffness: 160 } });
  const cta = spring({ frame: frame - 8, fps, config: { damping: 14, stiffness: 180 } });
  const label = outro.urlLabel || outro.url.replace(/^https?:\/\//, '');

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Backdrop brand={brand} vivid />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 60, gap: 30, color: '#fff' }}>
        <div style={{ transform: `scale(${0.8 + 0.2 * pop})`, opacity: pop }}>
          <Brandmark timeline={timeline} size={sz.mark} />
        </div>
        {tagline && product.tagline && (
          <div style={{ fontSize: fitFont(product.tagline, sz.name, sz.width, 2), fontWeight: 800, letterSpacing: -2, lineHeight: 1.05, textWrap: 'balance', maxWidth: sz.width, opacity: pop }}>
            {product.tagline}
          </div>
        )}
        {outro.cta && (
          <div
            style={{
              marginTop: 10,
              fontSize: sz.cta,
              fontWeight: 700,
              padding: `${sz.cta * 0.45}px ${sz.cta * 0.95}px`,
              borderRadius: 999,
              background: '#fff',
              color: brand.background,
              boxShadow: '0 16px 50px rgba(0,0,0,.3)',
              transform: `translateY(${(1 - cta) * 40}px)`,
              opacity: cta,
            }}
          >
            {outro.cta}
          </div>
        )}
        {label && <div style={{ fontSize: sz.url, fontWeight: 600, opacity: 0.92 * cta }}>{label}</div>}
        {outro.note && <div style={{ fontSize: sz.url * 0.72, fontWeight: 500, opacity: 0.75 * cta, maxWidth: sz.width }}>{outro.note}</div>}
      </AbsoluteFill>
      {outro.credit && timeline.music && (
        // Attribution the music license asks for, small at the bottom of the card.
        <div style={{ position: 'absolute', left: 40, right: 40, bottom: 34, textAlign: 'center', fontSize: sz.url * 0.55, color: '#fff', opacity: 0.6 * cta }}>
          {outro.credit}
        </div>
      )}
    </AbsoluteFill>
  );
};

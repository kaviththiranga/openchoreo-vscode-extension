import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { fitFont } from '../lib/camera';
import type { Brand } from '../types';

export type Slot = 'bottom-center' | 'top-center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

/**
 * One-line caption over a 16:9 clip, in the slot that covers the action least (chosen by
 * build_timeline.mjs). Centre slots are one line; side slots wrap to two lines in 46% of the width.
 * It fades out at `hideAt` so the key moment plays without text over it.
 */
export const Callout: React.FC<{ text: string; brand: Brand; place: Slot | 'top' | 'bottom'; delay?: number; width?: number; hideAt?: number }> = ({
  text,
  brand,
  place,
  delay = 6,
  width = 1920,
  hideAt,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!text) return null;
  const [v, h = 'center'] = place.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right' | undefined];
  const side = h !== 'center';
  const shown = spring({ frame: frame - delay, fps, config: { damping: 16, stiffness: 170 } });
  const p = hideAt === undefined ? shown : shown * interpolate(frame, [hideAt, hideAt + 9], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  if (p <= 0.001 && frame > delay) return null;
  const margin = Math.round(width * 0.035);
  const font = side ? fitFont(text, Math.round(width / 44), width * 0.4, 2, 0.52) : fitFont(text, Math.round(width / 40), width * 0.8, 1, 0.52);
  return (
    <div
      style={{
        position: 'absolute',
        [v]: margin,
        ...(side ? { [h]: margin, maxWidth: width * 0.46 } : { left: 0, right: 0 }),
        display: 'flex',
        justifyContent: side ? (h === 'left' ? 'flex-start' : 'flex-end') : 'center',
        opacity: p,
        transform: `translateY(${(1 - p) * (v === 'top' ? -30 : 30)}px)`,
      }}
    >
      <div
        style={{
          fontSize: font,
          fontWeight: 700,
          lineHeight: 1.25,
          color: '#fff',
          padding: `${font * 0.42}px ${font * 0.8}px`,
          borderRadius: font * 0.5,
          background: 'rgba(10,12,22,.84)',
          border: '1px solid rgba(255,255,255,.12)',
          boxShadow: `0 14px 44px rgba(0,0,0,.4), inset 5px 0 0 ${brand.accent}`,
          whiteSpace: side ? 'normal' : 'nowrap',
          textWrap: 'balance',
        }}
      >
        {text}
      </div>
    </div>
  );
};

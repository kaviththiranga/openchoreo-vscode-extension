import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { Brand } from '../types';

/** Thin progress line across the whole video. */
export const ProgressBar: React.FC<{ brand: Brand; y: number; height?: number }> = ({ brand, y, height = 6 }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width } = useVideoConfig();
  const p = Math.min(1, frame / Math.max(1, durationInFrames - 1));
  return (
    <div style={{ position: 'absolute', left: 0, top: y, width, height, background: 'rgba(255,255,255,.14)' }}>
      <div style={{ width: `${p * 100}%`, height: '100%', background: `linear-gradient(90deg, ${brand.secondary}, ${brand.accent})` }} />
    </div>
  );
};

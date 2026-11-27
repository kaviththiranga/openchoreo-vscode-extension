import { AbsoluteFill, useCurrentFrame } from 'remotion';
import type { Brand } from '../types';

/**
 * Brand background. `vivid` = a full gradient of the two brand colors (hook and end cards);
 * otherwise a dark base with soft glows (behind the clip panel in 9:16 / 1:1).
 */
export const Backdrop: React.FC<{ brand: Brand; vivid?: boolean }> = ({ brand, vivid }) => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 40) * 6; // slow movement so cards never look frozen
  if (vivid) {
    return (
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${30 + drift}% ${25 - drift}%, rgba(255,255,255,.22) 0%, transparent 45%),
            radial-gradient(circle at ${75 - drift}% 85%, rgba(0,0,0,.35) 0%, transparent 55%),
            linear-gradient(135deg, ${brand.primary} 0%, ${brand.secondary} 100%)`,
        }}
      />
    );
  }
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at ${25 + drift}% 10%, ${brand.primary}66 0%, transparent 55%),
          radial-gradient(ellipse at ${80 - drift}% 95%, ${brand.secondary}44 0%, transparent 50%), ${brand.background}`,
      }}
    />
  );
};

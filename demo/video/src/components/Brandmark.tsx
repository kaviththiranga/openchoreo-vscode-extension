import { Img, staticFile } from 'remotion';
import type { Timeline } from '../types';

/** Logo + product name, as a small chip (cards, headers). */
export const Brandmark: React.FC<{ timeline: Timeline; size: number; color?: string }> = ({ timeline, size, color = '#fff' }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.45 }}>
    {timeline.product.logo && <Img src={staticFile(timeline.product.logo)} style={{ height: size * 1.5, width: 'auto' }} />}
    <div style={{ fontSize: size, fontWeight: 700, color, letterSpacing: -0.3 }}>{timeline.product.name}</div>
  </div>
);

import { AbsoluteFill } from 'remotion';
import { Stage } from './components/Stage';
import { findScene } from './Short';
import type { PosterProps } from './types';

/** The key moment as a still (blog images, thumbnails): the 16:9 camera framing, no overlays. */
export const Poster: React.FC<PosterProps> = ({ scene: id, timeline }) => {
  if (!timeline || !timeline.scenes.length) return <AbsoluteFill style={{ background: '#000' }} />;
  const scene = findScene(timeline, id);
  const at = Math.min(scene.short.keyFrame + 12, scene.short.frames - 1);
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Stage scene={scene} plan={scene.short} layout="16x9" layouts={timeline.layouts} brand={timeline.brand} at={at} rings={false} />
    </AbsoluteFill>
  );
};

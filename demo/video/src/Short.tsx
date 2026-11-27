import { AbsoluteFill, interpolate, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { EndCard } from './components/EndCard';
import { HookCard } from './components/HookCard';
import { Music } from './components/Music';
import { ProgressBar } from './components/ProgressBar';
import { SceneBody } from './components/SceneBody';
import { Stage } from './components/Stage';
import { fontFamily } from './lib/font';
import type { LayoutName, Scene, ShortProps, Timeline } from './types';

export const findScene = (timeline: Timeline, id: string) => timeline.scenes.find((s) => s.id === id) ?? timeline.scenes[0];

/** Hook card → the clip (camera, speed ramps, caption) → end card, with a progress line. */
export const Short: React.FC<ShortProps> = ({ layout, scene: id, cards, timeline }) => {
  if (!timeline || !timeline.scenes.length) return <AbsoluteFill style={{ background: '#000' }} />;
  const scene = findScene(timeline, id);
  if (!cards) return <LoopClip scene={scene} timeline={timeline} layout={layout} />;
  const { hook, end, overlap } = timeline.cards;
  const sh = scene.short;
  const L = timeline.layouts[layout];
  const barY = layout === '9x16' ? L.panel.y + L.panel.h : L.height - 6;

  return (
    <AbsoluteFill style={{ background: timeline.brand.background, fontFamily }}>
      <Sequence from={sh.from} durationInFrames={sh.frames} name="clip">
        <SceneBody scene={scene} plan={sh} layout={layout} timeline={timeline} title={scene.hook} caption={scene.caption} enter={overlap + 2} />
      </Sequence>
      <Sequence durationInFrames={hook} name="hook">
        <HookCard text={scene.hook} timeline={timeline} layout={layout} />
      </Sequence>
      <Sequence from={sh.from + sh.frames - overlap} durationInFrames={end} name="end">
        <EndCard timeline={timeline} layout={layout} />
      </Sequence>
      <ProgressBar brand={timeline.brand} y={barY} />
      {timeline.music && <Music src={timeline.music} volume={timeline.musicVolume} />}
    </AbsoluteFill>
  );
};

/** The clip alone (README GIFs): camera and speed ramps, no cards or text; the end crossfades to the start so it loops. */
const LoopClip: React.FC<{ scene: Scene; timeline: Timeline; layout: LayoutName }> = ({ scene, timeline, layout }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const blend = interpolate(frame, [durationInFrames - 9, durationInFrames - 1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const props = { scene, plan: scene.short, layout, layouts: timeline.layouts, brand: timeline.brand };
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Stage {...props} />
      {blend > 0 && (
        <AbsoluteFill style={{ opacity: blend }}>
          <Stage {...props} at={0} />
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

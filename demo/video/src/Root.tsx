import { CalculateMetadataFunction, Composition, staticFile } from 'remotion';
import { Poster } from './Poster';
import { Reel } from './Reel';
import { Tour } from './Tour';
import { findScene, Short } from './Short';
import type { LayoutName, PosterProps, ReelProps, ShortProps, Timeline } from './types';

// Timeline data is fetched at render time, so `make timeline` + re-render is enough
// (no code change when scenes change).
async function loadTimeline(): Promise<Timeline> {
  const res = await fetch(staticFile('timeline.json'));
  if (!res.ok) throw new Error('public/timeline.json not found - run `make timeline` first');
  return (await res.json()) as Timeline;
}

const reelMeta: CalculateMetadataFunction<ReelProps> = async ({ props }) => {
  const timeline = await loadTimeline();
  return { durationInFrames: Math.max(1, timeline.reel.totalFrames), fps: timeline.fps, props: { ...props, timeline } };
};

const tourMeta: CalculateMetadataFunction<ReelProps> = async ({ props }) => {
  const timeline = await loadTimeline();
  return { durationInFrames: Math.max(1, timeline.tour.totalFrames), fps: timeline.fps, props: { ...props, timeline } };
};

const shortMeta: CalculateMetadataFunction<ShortProps> = async ({ props }) => {
  const timeline = await loadTimeline();
  if (!timeline.scenes.length) throw new Error('no scenes with clips in timeline.json');
  const s = findScene(timeline, props.scene).short;
  return { durationInFrames: props.cards ? s.total : s.frames, fps: timeline.fps, props: { ...props, timeline } };
};

const posterMeta: CalculateMetadataFunction<PosterProps> = async ({ props }) => {
  const timeline = await loadTimeline();
  return { durationInFrames: 1, fps: timeline.fps, props: { ...props, timeline } };
};

const SIZES: Record<LayoutName, [number, number]> = { '16x9': [1920, 1080], '9x16': [1080, 1920], '1x1': [1080, 1080] };

export const RemotionRoot: React.FC = () => (
  <>
    {/* Highlight reel (make reel). */}
    <Composition id="Landscape" component={Reel} width={1920} height={1080} fps={30} durationInFrames={300}
      defaultProps={{ layout: '16x9', timeline: null } satisfies ReelProps} calculateMetadata={reelMeta} />
    <Composition id="Portrait" component={Reel} width={1080} height={1920} fps={30} durationInFrames={300}
      defaultProps={{ layout: '9x16', timeline: null } satisfies ReelProps} calculateMetadata={reelMeta} />
    {/* Every feature in one video, chaptered by area (make tour). */}
    <Composition id="Tour-16x9" component={Tour} width={1920} height={1080} fps={30} durationInFrames={300}
      defaultProps={{ layout: '16x9', timeline: null } satisfies ReelProps} calculateMetadata={tourMeta} />
    <Composition id="Tour-9x16" component={Tour} width={1080} height={1920} fps={30} durationInFrames={300}
      defaultProps={{ layout: '9x16', timeline: null } satisfies ReelProps} calculateMetadata={tourMeta} />
    {/* One feature per short (make shorts): --props '{"scene":"<id>"}'. */}
    {(Object.keys(SIZES) as LayoutName[]).map((layout) => (
      <Composition key={layout} id={`Short-${layout}`} component={Short} width={SIZES[layout][0]} height={SIZES[layout][1]} fps={30}
        durationInFrames={300} defaultProps={{ layout, scene: '', cards: true, timeline: null } satisfies ShortProps} calculateMetadata={shortMeta} />
    ))}
    {/* The short's clip section alone, looping (make gifs). */}
    <Composition id="Clip-16x9" component={Short} width={1920} height={1080} fps={30} durationInFrames={300}
      defaultProps={{ layout: '16x9', scene: '', cards: false, timeline: null } satisfies ShortProps} calculateMetadata={shortMeta} />
    {/* Key-moment still (make posters). */}
    <Composition id="Poster" component={Poster} width={1920} height={1080} fps={30} durationInFrames={1}
      defaultProps={{ scene: '', timeline: null } satisfies PosterProps} calculateMetadata={posterMeta} />
  </>
);

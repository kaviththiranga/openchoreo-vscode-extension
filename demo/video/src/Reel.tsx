import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { EndCard } from './components/EndCard';
import { HookCard } from './components/HookCard';
import { ProgressBar } from './components/ProgressBar';
import { SceneBody } from './components/SceneBody';
import { fontFamily } from './lib/font';
import type { Cue, LayoutName, ReelProps, ReelScene, Scene, Timeline } from './types';

const activeCue = (cues: Cue[], f: number) => cues.find((c) => f >= c.from && f < c.to)?.text ?? '';

/** Highlight reel: tagline card → each highlighted scene's best window (chapter + caption) → end card. */
export const Reel: React.FC<ReelProps> = ({ layout, timeline }) => {
  if (!timeline) return <AbsoluteFill style={{ background: '#000' }} />;
  const { reel, brand, music } = timeline;
  const voiced = reel.scenes.some((s) => s.audio);
  const L = timeline.layouts[layout];
  const showCaptions = layout === '16x9' ? timeline.captions.landscape : timeline.captions.portrait;

  return (
    <AbsoluteFill style={{ background: brand.background, color: brand.text, fontFamily }}>
      {reel.scenes.map((r, i) => {
        const scene = timeline.scenes.find((s) => s.id === r.id)!;
        const nn = String(i + 1).padStart(2, '0');
        return (
          <Sequence key={r.id} from={r.start} durationInFrames={r.frames} name={r.id}>
            <ReelSceneView scene={scene} plan={r} nn={nn} layout={layout} timeline={timeline} showCaptions={showCaptions} />
            {r.audio && (
              <Sequence from={r.audioOffsetFrames} name="voice">
                <Audio src={staticFile(r.audio)} />
              </Sequence>
            )}
          </Sequence>
        );
      })}
      <Sequence durationInFrames={reel.intro.frames + timeline.cards.overlap} name="intro">
        <HookCard text={timeline.product.tagline || timeline.product.name} timeline={timeline} layout={layout} />
      </Sequence>
      <Sequence from={reel.outro.start - timeline.cards.overlap} durationInFrames={reel.outro.frames + timeline.cards.overlap} name="outro">
        <EndCard timeline={timeline} layout={layout} tagline={false} />
      </Sequence>
      <ProgressBar brand={brand} y={layout === '9x16' ? L.panel.y + L.panel.h : L.height - 6} />
      {music && (
        <Audio
          src={staticFile(music)}
          loop
          // Fade in/out; duck under the voiceover.
          volume={(f) =>
            interpolate(f, [0, 20, reel.totalFrames - 45, reel.totalFrames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) *
            timeline.musicVolume * (voiced ? 0.35 : 1)
          }
        />
      )}
    </AbsoluteFill>
  );
};

/** A reel scene: the hook as chapter title, the active caption cue (if captions are on for this layout). */
const ReelSceneView: React.FC<{ scene: Scene; plan: ReelScene; nn: string; layout: LayoutName; timeline: Timeline; showCaptions: boolean }> = ({
  scene,
  plan,
  nn,
  layout,
  timeline,
  showCaptions,
}) => {
  const frame = useCurrentFrame();
  const cue = showCaptions ? activeCue(plan.captions, frame) : '';
  const caption = layout === '16x9' ? `${nn}  ${scene.hook}${cue ? ` — ${cue}` : ''}` : cue;
  return (
    <SceneBody scene={scene} plan={plan} layout={layout} timeline={timeline} title={scene.hook} eyebrow={`${nn} · ${timeline.product.name}`} caption={caption} enter={6} />
  );
};

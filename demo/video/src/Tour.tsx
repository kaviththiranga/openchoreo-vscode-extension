import { AbsoluteFill, Sequence } from 'remotion';
import { ChapterCard } from './components/ChapterCard';
import { EndCard } from './components/EndCard';
import { HookCard } from './components/HookCard';
import { Music } from './components/Music';
import { ProgressBar } from './components/ProgressBar';
import { SceneBody } from './components/SceneBody';
import { fontFamily } from './lib/font';
import type { ReelProps } from './types';

/**
 * Every feature in one video: tagline → for each storyboard `area` an animated chapter card,
 * then each of its scenes cut to the moments around its key moment (hook as the title) → end card.
 */
export const Tour: React.FC<ReelProps> = ({ layout, timeline }) => {
  if (!timeline) return <AbsoluteFill style={{ background: '#000' }} />;
  const { tour, brand, cards } = timeline;
  const L = timeline.layouts[layout];
  return (
    <AbsoluteFill style={{ background: brand.background, color: brand.text, fontFamily }}>
      {tour.items.map((item, i) => {
        if (item.kind === 'chapter') {
          return (
            <Sequence key={`chapter-${i}`} from={item.start} durationInFrames={item.frames + cards.overlap} name={`chapter ${item.title}`}>
              <ChapterCard chapter={item} timeline={timeline} layout={layout} />
            </Sequence>
          );
        }
        const scene = timeline.scenes.find((s) => s.id === item.id)!;
        return (
          <Sequence key={item.id} from={item.start} durationInFrames={item.frames} name={item.id}>
            <SceneBody
              scene={scene}
              plan={item}
              layout={layout}
              timeline={timeline}
              title={scene.hook}
              eyebrow={item.area ?? timeline.product.name}
              caption={layout === '16x9' ? scene.hook : scene.caption}
              enter={4}
            />
          </Sequence>
        );
      })}
      <Sequence durationInFrames={tour.intro.frames + cards.overlap} name="intro">
        <HookCard text={timeline.product.tagline || timeline.product.name} timeline={timeline} layout={layout} />
      </Sequence>
      <Sequence from={tour.outro.start - cards.overlap} durationInFrames={tour.outro.frames + cards.overlap} name="outro">
        <EndCard timeline={timeline} layout={layout} tagline={false} />
      </Sequence>
      <ProgressBar brand={brand} y={layout === '9x16' ? L.panel.y + L.panel.h : L.height - 6} />
      {timeline.music && <Music src={timeline.music} volume={timeline.musicVolume} />}
    </AbsoluteFill>
  );
};

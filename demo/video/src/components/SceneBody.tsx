import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { fitFont } from '../lib/camera';
import type { LayoutName, Plan, Scene, Timeline } from '../types';
import { Backdrop } from './Backdrop';
import { Brandmark } from './Brandmark';
import { Callout } from './Callout';
import { Stage } from './Stage';

/**
 * One scene in a layout. 16:9: the clip fills the frame, the caption is an overlay pill placed
 * away from the action. 9:16 and 1:1: a header (title + caption) above the clip panel, so text
 * never covers the product and stays readable on phones.
 */
export const SceneBody: React.FC<{
  scene: Scene;
  plan: Plan;
  layout: LayoutName;
  timeline: Timeline;
  title: string;
  caption: string;
  eyebrow?: string;
  enter?: number;
  rings?: boolean;
}> = ({ scene, plan, layout, timeline, title, caption, eyebrow, enter = 0, rings }) => {
  const frame = useCurrentFrame();
  const L = timeline.layouts[layout];
  const settle = enter ? interpolate(frame, [0, enter], [1.07, 1], { extrapolateRight: 'clamp' }) : 1;
  const stage = <Stage scene={scene} plan={plan} layout={layout} layouts={timeline.layouts} brand={timeline.brand} rings={rings} />;

  if (layout === '16x9') {
    return (
      <AbsoluteFill style={{ background: '#000' }}>
        <AbsoluteFill style={{ transform: `scale(${settle})` }}>{stage}</AbsoluteFill>
        <Callout
          text={caption}
          brand={timeline.brand}
          place={plan.captionAt['16x9'] ?? 'bottom-center'}
          delay={enter + 4}
          width={L.width}
          // Up for ~2.5-5 s: readable, then out of the action's way, and gone before the key moment.
          hideAt={Math.min(Math.max(enter + 4 + 75, plan.keyFrame - 12), enter + 4 + 150)}
        />
      </AbsoluteFill>
    );
  }

  const portrait = layout === '9x16';
  const width = L.width - 120;
  const titleFont = fitFont(title, portrait ? 80 : 58, width, portrait ? 2 : 1);
  const capFont = fitFont(caption, portrait ? 42 : 34, width, 2, 0.5);
  const head = interpolate(frame, [enter, enter + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill>
      <Backdrop brand={timeline.brand} />
      <div
        style={{
          position: 'absolute',
          left: 60,
          right: 60,
          ...(portrait ? { top: 110, height: L.panel.y - 110 - 36 } : { top: 0, height: L.panel.y }),
          display: 'flex',
          flexDirection: 'column',
          justifyContent: portrait ? 'flex-end' : 'center',
          alignItems: 'center',
          textAlign: 'center',
          gap: portrait ? 18 : 8,
          color: '#fff',
          opacity: head,
          transform: `translateY(${(1 - head) * 20}px)`,
        }}
      >
        {portrait &&
          (eyebrow ? (
            <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 2.5, textTransform: 'uppercase', color: timeline.brand.accent }}>{eyebrow}</div>
          ) : (
            <Brandmark timeline={timeline} size={30} />
          ))}
        <div style={{ fontSize: titleFont, fontWeight: 800, textWrap: 'balance', lineHeight: 1.05, letterSpacing: -titleFont * 0.025 }}>{title}</div>
        {caption && <div style={{ fontSize: capFont, fontWeight: 500, textWrap: 'balance', lineHeight: 1.25, opacity: 0.86 }}>{caption}</div>}
      </div>
      <div
        style={{
          position: 'absolute',
          left: L.panel.x,
          top: L.panel.y,
          width: L.panel.w,
          height: L.panel.h,
          overflow: 'hidden',
          transform: `scale(${settle})`,
          background: 'rgba(0,0,0,.25)',
        }}
      >
        {stage}
      </div>
    </AbsoluteFill>
  );
};

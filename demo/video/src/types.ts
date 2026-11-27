// Shape of public/timeline.json, written by scripts/tools/build_timeline.mjs.
export type Box = { x: number; y: number; w: number; h: number };
export type CameraKey = { f: number; x: number; y: number; s: number };
export type Target = { f: number; until?: number; box: Box | null; label: string; derived?: boolean };
export type Cue = { text: string; from: number; to: number };

export type LayoutName = '16x9' | '9x16' | '1x1';
export type Layout = {
  width: number;
  height: number;
  panel: { x: number; y: number; w: number; h: number };
  sMin: number;
  sTarget: number;
  sMax: number;
  pad: number;
};

/** One window of a clip: output frame → clip seconds (`map`), camera keyframes per layout. */
export type Plan = {
  map: number[];
  frames: number;
  keyFrame: number;
  targets: Target[];
  camera: Partial<Record<LayoutName, CameraKey[]>>;
  captionAt: Partial<Record<LayoutName, 'bottom-center' | 'top-center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'>>;
};

export type Scene = {
  id: string;
  title: string;
  hook: string;
  caption: string;
  narration: string;
  clip: string;
  clipFrames: number;
  srcAspect: number;
  /** `from` = frame the clip starts at (after the hook card), `total` = whole short. */
  short: Plan & { from: number; total: number };
};

export type ReelScene = Plan & {
  id: string;
  start: number;
  captions: Cue[];
  audio: string | null;
  audioOffsetFrames: number;
};

/** Tour: every scene, with a chapter card whenever the storyboard `area` changes. */
export type TourChapter = { kind: 'chapter'; title: string; n: number; of: number; features: string[]; start: number; frames: number };
export type TourItem = TourChapter | (ReelScene & { kind: 'scene'; area: string | null });

/** primary → secondary: card gradient; accent: rings, ripples, caption bar; background: behind panels. */
export type Brand = { primary: string; secondary: string; accent: string; background: string; text: string };

export type Timeline = {
  fps: number;
  product: { name: string; tagline: string; logo: string | null };
  brand: Brand;
  captions: { landscape: boolean; portrait: boolean };
  music: string | null;
  /** Music level, 0..1 (style.music_volume); the reel ducks it to a third under voiceover. */
  musicVolume: number;
  layouts: Record<LayoutName, Layout>;
  cards: { hook: number; end: number; overlap: number };
  outro: { cta: string; url: string; urlLabel: string; note: string; credit: string };
  scenes: Scene[];
  reel: { intro: { frames: number }; scenes: ReelScene[]; outro: { start: number; frames: number }; totalFrames: number };
  tour: { intro: { frames: number }; items: TourItem[]; outro: { start: number; frames: number }; totalFrames: number };
};

export type ReelProps = { layout: LayoutName; timeline: Timeline | null };
export type ShortProps = { layout: LayoutName; scene: string; cards: boolean; timeline: Timeline | null };
export type PosterProps = { scene: string; timeline: Timeline | null };

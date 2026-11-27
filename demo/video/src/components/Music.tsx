import { Audio, interpolate, staticFile, useVideoConfig } from 'remotion';

/** Background music for a whole composition: looped, faded in and out, at `volume`. */
export const Music: React.FC<{ src: string; volume: number }> = ({ src, volume }) => {
  const { durationInFrames } = useVideoConfig();
  return (
    <Audio
      src={staticFile(src)}
      loop
      volume={(f) => volume * interpolate(f, [0, 12, durationInFrames - 40, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
    />
  );
};

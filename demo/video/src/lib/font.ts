import { loadFont } from '@remotion/google-fonts/Inter';

// Inter, fetched at render time. Swap for the product's brand font here.
export const { fontFamily } = loadFont('normal', { weights: ['500', '600', '700', '800'], subsets: ['latin'] });

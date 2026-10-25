// Ported from vision (backend/src/a11y/contrast.ts): keep in sync until both use a shared package.

import type {RgbaImage} from './types';
import type {Rect} from './ui-tree.types';

type Rgb = [number, number, number];

// WCAG relative luminance of an sRGB colour
export function luminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Pixels of a colour that only differs this little from the background are
// treated as anti-aliasing of the background, not as text.
const MIN_FOREGROUND_CONTRAST = 1.25;
// A colour has to cover this share of the non-background pixels to count as the
// text colour; smaller ones are edge blending.
const MIN_FOREGROUND_SHARE = 0.08;
const MAX_SAMPLES = 40000;

export interface ContrastEstimate {
  ratio: number;
  foreground: string;
  background: string;
}

const hex = ([r, g, b]: Rgb) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/**
 * Estimates text contrast inside a box of the screenshot, the way Android's
 * Accessibility Test Framework does: the most common colour is the background,
 * the strongest common colour that differs from it is the text. Null when the
 * box is empty or uniform (nothing drawn there to measure).
 */
export function estimateContrast(image: RgbaImage, rect: Rect): ContrastEstimate | null {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(image.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(image.height, Math.ceil(rect.y + rect.height));
  if (x1 - x0 < 4 || y1 - y0 < 4) {
    return null;
  }

  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / MAX_SAMPLES)));
  // 4 bits per channel: close shades share a bucket, the bucket keeps their average
  const buckets = new Map<number, {count: number; sum: Rgb}>();
  let total = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * image.width + x) * 4;
      const r = image.data[i];
      const g = image.data[i + 1];
      const b = image.data[i + 2];
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bucket = buckets.get(key) ?? {count: 0, sum: [0, 0, 0] as Rgb};
      bucket.count++;
      bucket.sum[0] += r;
      bucket.sum[1] += g;
      bucket.sum[2] += b;
      buckets.set(key, bucket);
      total++;
    }
  }
  if (!total) {
    return null;
  }

  const colours = [...buckets.values()]
    .map(({count, sum}) => ({count, rgb: sum.map((v) => v / count) as Rgb}))
    .sort((a, b) => b.count - a.count);
  const background = colours[0];
  const others = colours.slice(1).filter((c) => contrastRatio(c.rgb, background.rgb) >= MIN_FOREGROUND_CONTRAST);
  const otherPixels = others.reduce((sum, c) => sum + c.count, 0);
  if (!otherPixels) {
    return null;
  }

  const candidates = others.filter((c) => c.count >= otherPixels * MIN_FOREGROUND_SHARE);
  const foreground = (candidates.length ? candidates : others).reduce((best, c) =>
    contrastRatio(c.rgb, background.rgb) > contrastRatio(best.rgb, background.rgb) ? c : best,
  );
  return {
    ratio: Math.round(contrastRatio(foreground.rgb, background.rgb) * 100) / 100,
    foreground: hex(foreground.rgb),
    background: hex(background.rgb),
  };
}

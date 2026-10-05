import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageData, createCanvas, loadImage } from '@napi-rs/canvas';
import { VARIANTS, getVariant, type Variant } from '../data/variants';
import { overlaysFromDextrousLayout, whiteToTransparent } from './cutout';
import { parseLayout } from './layout';
import { paletteFromColors, recolorFrame, type FrameRegions } from './recolor';

/** The variant the source files were exported as. Every other variant is derived from it. */
export const BASE_VARIANT = 'blue';

export interface FrameImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * The base frame as an RGBA image: the Dextrous export with its white background removed (the same result as
 * `npm run frame:cutout`), read from `assets/frames/source/`.
 */
export async function loadBaseFrame(framesDir: string): Promise<{ frame: FrameImage; regions: FrameRegions }> {
  const source = join(framesDir, 'source');
  const image = await loadImage(await readFile(join(source, 'blue-template.png')));
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, image.width, image.height);

  const dextrous = JSON.parse(await readFile(join(source, 'blue-layout.json'), 'utf8'));
  const overlays = overlaysFromDextrousLayout(dextrous, image.width);
  const data = whiteToTransparent(pixels.data, image.width, image.height, overlays);

  const layout = parseLayout(JSON.parse(await readFile(join(framesDir, 'layout.json'), 'utf8')));
  const scale = image.width / layout.card.width;
  const toPixels = (r: { x: number; y: number; width: number; height: number }) => ({ x: r.x * scale, y: r.y * scale, width: r.width * scale, height: r.height * scale });
  return {
    frame: { data, width: image.width, height: image.height },
    regions: { banner: toPixels(layout.fields.name), description: toPixels(layout.fields.description) },
  };
}

/** The frame in a variant's colours. The base variant is returned as is. */
export function frameForVariant(base: FrameImage, regions: FrameRegions, variant: Variant): FrameImage {
  if (variant.id === BASE_VARIANT) return base;
  const from = getVariant(BASE_VARIANT);
  if (!from) throw new Error(`The registry has no "${BASE_VARIANT}" variant to derive frames from`);
  return { ...base, data: recolorFrame(base.data, base.width, base.height, regions, paletteFromColors(from.colors), paletteFromColors(variant.colors)) };
}

export function encodePng(frame: FrameImage): Buffer {
  const canvas = createCanvas(frame.width, frame.height);
  canvas.getContext('2d').putImageData(new ImageData(frame.data, frame.width, frame.height), 0, 0);
  return canvas.toBuffer('image/png');
}

export const frameFileName = (variantId: string): string => `variant-${variantId}.png`;

export async function buildAllVariantFrames(framesDir: string): Promise<{ variant: Variant; frame: FrameImage }[]> {
  const { frame, regions } = await loadBaseFrame(framesDir);
  return VARIANTS.map((variant) => ({ variant, frame: frameForVariant(frame, regions, variant) }));
}

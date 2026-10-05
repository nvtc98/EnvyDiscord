import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { VARIANTS, getVariant } from '../src/data/variants';
import { paletteFromColors, parseColor, recolorFrame, type FramePalette } from '../src/render/recolor';
import { BASE_VARIANT, buildAllVariantFrames, frameFileName, loadBaseFrame } from '../src/render/variant-frames';

const FRAMES = join(__dirname, '..', 'assets', 'frames');
const px = (data: Uint8ClampedArray, width: number, x: number, y: number) => Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4));

async function readPng(file: string) {
  const img = await loadImage(await readFile(file));
  const ctx = createCanvas(img.width, img.height).getContext('2d');
  ctx.drawImage(img, 0, 0);
  return { data: ctx.getImageData(0, 0, img.width, img.height).data, width: img.width, height: img.height };
}

/** The largest difference between two images as the eye sees it: alpha, and colour weighted by alpha (the colour of a transparent pixel means nothing). */
function maxDifference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let worst = 0;
  for (let i = 0; i < a.length; i += 4) {
    worst = Math.max(worst, Math.abs(a[i + 3] - b[i + 3]));
    for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs((a[i + c] * a[i + 3]) / 255 - (b[i + c] * b[i + 3]) / 255));
  }
  return worst;
}

const near = (actual: number[], expected: number[], tolerance: number) => actual.forEach((v, i) => expect(Math.abs(v - expected[i]), `${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance));

describe('parseColor', () => {
  it('reads hex and rgb()/rgba() colours', () => {
    expect(parseColor('#0B57A5')).toEqual({ rgb: [11, 87, 165], alpha: 1 });
    expect(parseColor('#abc')).toEqual({ rgb: [170, 187, 204], alpha: 1 });
    expect(parseColor('rgba(102, 102, 102, 0.58)')).toEqual({ rgb: [102, 102, 102], alpha: 0.58 });
    expect(parseColor('rgb(1,2,3)')).toEqual({ rgb: [1, 2, 3], alpha: 1 });
  });
  it('rejects what it cannot read instead of guessing', () => {
    expect(() => parseColor('blue')).toThrow(/Cannot read/);
    expect(() => parseColor('#12345')).toThrow();
  });
});

describe('recolorFrame', () => {
  const blue = paletteFromColors(getVariant('blue')!.colors);
  const red = paletteFromColors(getVariant('red')!.colors);
  const W = 40;
  const H = 30;
  const regions = { banner: { x: 2, y: 2, width: 36, height: 8 }, description: { x: 6, y: 12, width: 28, height: 14 } };

  /** A tiny frame: a banner row going light to dark, a translucent panel, a black outline and transparent elsewhere. */
  function tiny(): Uint8ClampedArray {
    const data = new Uint8ClampedArray(W * H * 4);
    const set = (x: number, y: number, rgba: number[]) => data.set(rgba, (y * W + x) * 4);
    for (let x = 2; x < 38; x++) {
      const t = Math.abs(x - 20) / 18; // 0 in the middle, 1 at the ends
      for (let y = 2; y < 10; y++) set(x, y, [0, 1, 2].map((c) => Math.round(blue.titleLight[c] + (blue.titleDark[c] - blue.titleLight[c]) * t)).concat(255));
    }
    for (let y = 12; y < 26; y++) for (let x = 6; x < 34; x++) set(x, y, [...blue.descRgb, Math.round(blue.descAlpha * 255)]);
    for (let x = 0; x < W; x++) set(x, 29, [0, 0, 0, 255]); // a black outline row
    return data;
  }

  it('maps the banner gradient endpoints onto the new variant\'s light and dark colours', () => {
    const out = recolorFrame(tiny(), W, H, regions, blue, red);
    near(px(out, W, 20, 5), [...red.titleLight, 255], 1); // the middle is the light stop
    near(px(out, W, 2, 5), [...red.titleDark, 255], 1); // the far end is the dark stop
    const middle = px(out, W, 11, 5); // halfway between: halfway between the new colours
    near(middle, [0, 1, 2].map((c) => Math.round((red.titleLight[c] + red.titleDark[c]) / 2)).concat(255), 2);
  });

  it('gives the description panel the new colour and rescales its opacity', () => {
    const out = recolorFrame(tiny(), W, H, regions, blue, red);
    const [r, g, b, a] = px(out, W, 20, 18);
    expect([r, g, b]).toEqual(red.descRgb);
    expect(a).toBe(Math.round(Math.round(blue.descAlpha * 255) * (red.descAlpha / blue.descAlpha)));
    expect(a / 255).toBeCloseTo(red.descAlpha, 1);
  });

  it('leaves the outline, transparent pixels and alpha everywhere else exactly as they were', () => {
    const before = tiny();
    const out = recolorFrame(before, W, H, regions, blue, red);
    expect(px(out, W, 10, 29)).toEqual([0, 0, 0, 255]);
    expect(px(out, W, 0, 0)).toEqual([0, 0, 0, 0]);
    for (let i = 3; i < before.length; i += 4) if (i % 4 === 3 && before[i] !== 255 && before[i] !== 0) continue; // description alpha changes by design
    for (let y = 2; y < 10; y++) for (let x = 2; x < 38; x++) expect(px(out, W, x, y)[3]).toBe(255); // banner alpha untouched
  });

  it('keeps the anti-aliased alpha on the banner edge', () => {
    const data = tiny();
    data[(5 * W + 2) * 4 + 3] = 90; // an edge pixel with partial alpha
    const out = recolorFrame(data, W, H, regions, blue, red);
    expect(px(out, W, 2, 5)[3]).toBe(90);
  });

  it('does not mistake the description panel for the banner when they touch', () => {
    const data = tiny();
    for (let x = 6; x < 34; x++) data.set([...blue.descRgb, Math.round(blue.descAlpha * 255)], (10 * W + x) * 4); // a panel row directly under the banner
    const out = recolorFrame(data, W, H, regions, blue, red);
    expect(px(out, W, 20, 10).slice(0, 3)).toEqual(red.descRgb);
  });

  it('is the identity when the source and target are the same, and does not modify its input', () => {
    const data = tiny();
    const copy = new Uint8ClampedArray(data);
    expect(Array.from(recolorFrame(data, W, H, regions, blue, blue))).toEqual(Array.from(copy));
    recolorFrame(data, W, H, regions, blue, red);
    expect(Array.from(data)).toEqual(Array.from(copy));
  });

  it('copes with a gradient whose two colours are equal', () => {
    const flat: FramePalette = { ...blue, titleDark: blue.titleLight };
    expect(() => recolorFrame(tiny(), W, H, regions, flat, red)).not.toThrow();
  });
});

describe('the shipped variant frames', () => {
  it('there is one file per variant in the registry, with transparency, at the size of the base frame', async () => {
    for (const v of VARIANTS) {
      const frame = await readPng(join(FRAMES, frameFileName(v.id)));
      expect([frame.width, frame.height], v.id).toEqual([750, 1050]);
      expect(px(frame.data, 750, 6, 500)[3], `${v.id}: the outline is solid`).toBe(255);
      expect(px(frame.data, 750, 375, 400)[3], `${v.id}: the middle of the card is transparent so the art shows`).toBe(0);
    }
  });

  it('every variant has the banner and description colours the registry gives it', async () => {
    for (const v of VARIANTS) {
      const palette = paletteFromColors(v.colors);
      const frame = await readPng(join(FRAMES, frameFileName(v.id)));
      // The banner's centre is the light stop; its ends are close to the dark stop.
      near(px(frame.data, 750, 375, 750), [...palette.titleLight, 255], 2);
      const edge = px(frame.data, 750, 40, 750);
      expect(Math.hypot(...[0, 1, 2].map((c) => edge[c] - palette.titleDark[c])), `${v.id} banner end`).toBeLessThan(
        Math.hypot(...[0, 1, 2].map((c) => palette.titleLight[c] - palette.titleDark[c])) * 0.6,
      );
      // The description panel: the registry's colour at the registry's opacity (colour is imprecise at low alpha).
      const desc = px(frame.data, 750, 375, 900);
      near(desc.slice(0, 3), palette.descRgb, 4);
      expect(desc[3] / 255, v.id).toBeCloseTo(palette.descAlpha, 1);
    }
  });

  it('the variants look different from each other, and the outline and badges are shared', async () => {
    const frames = await Promise.all(VARIANTS.map(async (v) => ({ v, frame: await readPng(join(FRAMES, frameFileName(v.id))) })));
    for (let i = 0; i < frames.length; i++) {
      for (let j = i + 1; j < frames.length; j++) {
        expect(px(frames[i].frame.data, 750, 375, 750), `${frames[i].v.id} vs ${frames[j].v.id} banner`).not.toEqual(px(frames[j].frame.data, 750, 375, 750));
      }
      expect(px(frames[i].frame.data, 750, 40, 40), 'badge').toEqual([0, 0, 0, 255]);
      expect(px(frames[i].frame.data, 750, 6, 500), 'outline').toEqual([0, 0, 0, 255]);
    }
  });

  it('the blue variant is the original Dextrous Blue frame, unchanged', async () => {
    const blueFrame = await readPng(join(FRAMES, frameFileName(BASE_VARIANT)));
    const original = await readPng(join(FRAMES, 'tier-1.png'));
    expect(maxDifference(blueFrame.data, original.data)).toBeLessThanOrEqual(1);
  });

  it('the files are up to date with src/data/variants.ts: regenerating them changes nothing', async () => {
    const built = await buildAllVariantFrames(FRAMES);
    for (const { variant, frame } of built) {
      const shipped = await readPng(join(FRAMES, frameFileName(variant.id)));
      // Slack for the PNG round trip through a premultiplied canvas; a changed colour would differ by far more.
      expect(maxDifference(shipped.data, frame.data), `${variant.id} is stale: run npm run frames:variants`).toBeLessThanOrEqual(4);
    }
  });

  it('regions are found from layout.json and sit where the banner and the panel are', async () => {
    const { regions } = await loadBaseFrame(FRAMES);
    expect(regions.banner).toMatchObject({ x: 18.75, y: 712.5, width: 712.5, height: 75 });
    expect(regions.description).toMatchObject({ x: 56.25, y: 787.5, width: 637.5, height: 225 });
  });
});

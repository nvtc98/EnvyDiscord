import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { compositeOver, cutoutStats, overlaysFromDextrousLayout, whiteToTransparent } from '../src/render/cutout';

/** Builds RGBA data from rows of [r,g,b] tuples. */
function image(rows: number[][][]): { data: Uint8ClampedArray; width: number; height: number } {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) => row.forEach(([r, g, b], x) => data.set([r, g, b, 255], (y * width + x) * 4)));
  return { data, width, height };
}
const px = (data: Uint8ClampedArray, width: number, x: number, y: number) => Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4));

const W = [255, 255, 255], K = [0, 0, 0];

describe('whiteToTransparent', () => {
  it('makes pure white transparent and keeps solid colors opaque', () => {
    const { data, width, height } = image([
      [W, W, W],
      [W, [11, 87, 165], W],
      [W, W, W],
    ]);
    const out = whiteToTransparent(data, width, height);
    expect(px(out, width, 0, 0)[3]).toBe(0);
    expect(px(out, width, 1, 1)).toEqual([11, 87, 165, 255]);
  });

  it('turns an anti-aliased edge into the dark color with partial alpha (no white halo)', () => {
    const { data, width, height } = image([[K, K, [128, 128, 128], W, W]]);
    const out = whiteToTransparent(data, width, height);
    const [r, g, b, a] = px(out, width, 2, 0);
    expect([r, g, b]).toEqual([0, 0, 0]);
    expect(a).toBeGreaterThan(115);
    expect(a).toBeLessThan(140); // about half covered
    expect(px(out, width, 3, 0)[3]).toBe(0);
  });

  it('restores a flattened semi-transparent overlay to its color and alpha', () => {
    // A navy box at 48% over white flattens to (134,148,163), exactly as the Dextrous export did.
    const flat = [134, 148, 163];
    const rows = Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => (x >= 2 && x < 6 && y >= 2 && y < 6 ? flat : W)));
    const { data, width, height } = image(rows);
    const out = whiteToTransparent(data, width, height, [{ x: 2, y: 2, w: 4, h: 4, rgb: [3, 32, 62], alpha: 0.48 }]);
    const [r, g, b, a] = px(out, width, 3, 3);
    expect([r, g, b]).toEqual([3, 32, 62]);
    expect(a).toBeGreaterThan(120);
    expect(a).toBeLessThan(125); // 0.48 * 255
    expect(px(out, width, 0, 0)[3]).toBe(0); // the white around it is gone
  });

  it('never touches darker artwork next to an overlay', () => {
    const rows = [[W, W, W, W, W], [W, [134, 148, 163], [134, 148, 163], W, W], [K, K, K, K, K]];
    const { data, width, height } = image(rows);
    const out = whiteToTransparent(data, width, height, [{ x: 1, y: 1, w: 2, h: 1, rgb: [3, 32, 62], alpha: 0.48 }]);
    expect(px(out, width, 2, 2)).toEqual([0, 0, 0, 255]); // the black row below stays opaque black
  });

  it('does not modify its input', () => {
    const { data, width, height } = image([[W, K], [K, W]]);
    const copy = new Uint8ClampedArray(data);
    whiteToTransparent(data, width, height);
    expect(Array.from(data)).toEqual(Array.from(copy));
  });

  it('laid back over white, the result matches the original (the round trip loses nothing)', () => {
    const rows = Array.from({ length: 12 }, (_, y) =>
      Array.from({ length: 12 }, (_, x) => (x === 0 || y === 0 || x === 11 || y === 11 ? K : x === 1 || y === 1 ? [90, 90, 90] : x === 2 ? [200, 200, 200] : W)),
    );
    const { data, width, height } = image(rows);
    const back = compositeOver(whiteToTransparent(data, width, height), [255, 255, 255]);
    for (let i = 0; i < data.length; i++) expect(Math.abs(back[i] - data[i])).toBeLessThanOrEqual(3);
  });
});

describe('overlaysFromDextrousLayout', () => {
  it('finds the semi-transparent description box in the real Blue layout, scaled to the image', async () => {
    const layout = JSON.parse(await readFile(join(__dirname, '..', 'assets', 'frames', 'source', 'blue-layout.json'), 'utf8'));
    const overlays = overlaysFromDextrousLayout(layout, 750);
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toMatchObject({ rgb: [3, 32, 62], alpha: 0.48 });
    expect(overlays[0].x).toBeCloseTo(18 * 3.125, 1);
    expect(overlays[0].y).toBeCloseTo(252 * 3.125, 1);
    expect(overlays[0].w).toBeCloseTo(204 * 3.125, 1);
    expect(overlays[0].h).toBeCloseTo(72 * 3.125, 1);
  });

  it('ignores layouts it does not understand', () => {
    expect(overlaysFromDextrousLayout({}, 750)).toEqual([]);
    expect(overlaysFromDextrousLayout({ layoutData: { style: { width: 'wide' } } }, 750)).toEqual([]);
  });
});

describe('the Blue frame shipped in assets', () => {
  it('is the cutout of the original template: transparent inside, and identical over white', async () => {
    const dir = join(__dirname, '..', 'assets', 'frames');
    const load = async (file: string) => {
      const img = await loadImage(await readFile(file));
      const ctx = createCanvas(img.width, img.height).getContext('2d');
      ctx.drawImage(img, 0, 0);
      return { data: ctx.getImageData(0, 0, img.width, img.height).data, width: img.width, height: img.height };
    };
    const source = await load(join(dir, 'source', 'blue-template.png'));
    const frame = await load(join(dir, 'tier-1.png'));
    expect(frame.width).toBe(750);
    expect(frame.height).toBe(1050);

    const stats = cutoutStats(frame.data);
    expect(stats.transparent / (750 * 1050)).toBeGreaterThan(0.6); // the big interior
    expect(px(frame.data, 750, 375, 400)[3]).toBe(0);
    expect(px(frame.data, 750, 375, 750)[3]).toBe(255); // name banner is opaque
    const desc = px(frame.data, 750, 375, 900);
    expect(desc[3]).toBeGreaterThan(115);
    expect(desc[3]).toBeLessThan(130); // description box ~48%

    const a = compositeOver(frame.data, [255, 255, 255]);
    const b = compositeOver(source.data, [255, 255, 255]);
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
    expect(worst).toBeLessThanOrEqual(3);
  });
});

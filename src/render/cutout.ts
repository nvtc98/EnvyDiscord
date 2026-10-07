/**
 * Turns a frame exported with a solid white background into a PNG with real transparency.
 *
 *  1. Pure white becomes fully transparent.
 *  2. Anti-aliased edges (a dark shape blended with white) become the dark shape with partial alpha,
 *     so no white halo is left around the border.
 *  3. Semi-transparent overlays that the design tool flattened onto the white background (for example a
 *     description box drawn at 48% opacity) are un-blended back to their colour plus alpha, using the
 *     colours and positions found in the Dextrous layout export.
 *
 * Everything here works on plain RGBA arrays so it can be unit tested without any image library.
 */

export interface Overlay {
  /** Rectangle in image pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  rgb: [number, number, number];
  alpha: number;
}

export interface CutoutStats {
  transparent: number;
  semiTransparent: number;
  opaque: number;
}

const WHITE_MIN = 250;
const isWhite = (d: Uint8ClampedArray, i: number) =>
  d[i + 3] === 255 &&
  d[i] >= WHITE_MIN &&
  d[i + 1] >= WHITE_MIN &&
  d[i + 2] >= WHITE_MIN;
const darkness = (r: number, g: number, b: number) => 255 - (r + g + b) / 3;
const distFromWhite = (r: number, g: number, b: number) =>
  Math.hypot(255 - r, 255 - g, 255 - b);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Reads solid-colour `rgba()` backgrounds with partial alpha from the top-level text zones of a Dextrous layout. */
export function overlaysFromDextrousLayout(
  layout: unknown,
  imageWidth: number,
): Overlay[] {
  const root = (
    layout as {
      layoutData?: { style?: Record<string, string>; childZones?: unknown[] };
    }
  ).layoutData;
  if (!root?.style) return [];
  const cardWidth = parseFloat(root.style.width);
  if (!Number.isFinite(cardWidth) || cardWidth <= 0) return [];
  const scale = imageWidth / cardWidth;

  const overlays: Overlay[] = [];
  for (const zone of root.childZones ?? []) {
    const z = zone as { type?: string; style?: Record<string, string> };
    const style = z.style;
    if (!style || z.type !== "text" || style.display === "none") continue;
    const m =
      /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(
        (style.background ?? "").trim(),
      );
    if (!m) continue;
    const alpha = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (!(alpha > 0.02 && alpha < 0.98)) continue;
    const [left, top, width, height] = [
      style.left,
      style.top,
      style.width,
      style.height,
    ].map(parseFloat);
    if (![left, top, width, height].every(Number.isFinite)) continue;
    overlays.push({
      x: left * scale,
      y: top * scale,
      w: width * scale,
      h: height * scale,
      rgb: [+m[1], +m[2], +m[3]],
      alpha,
    });
  }
  return overlays;
}

/** Returns a new RGBA array with the white background removed. `data` is not modified. */
export function whiteToTransparent(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  overlays: Overlay[] = [],
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data);
  const handled = new Uint8Array(width * height);

  // Step 3 first: un-blend flattened overlays, so their colour is not mistaken for foreground later.
  for (const o of overlays) {
    const blended = o.rgb.map((c) => o.alpha * c + (1 - o.alpha) * 255) as [
      number,
      number,
      number,
    ];
    const blendedDark = darkness(...blended);
    const x0 = Math.max(0, Math.floor(o.x) - 1),
      x1 = Math.min(width - 1, Math.ceil(o.x + o.w));
    const y0 = Math.max(0, Math.floor(o.y) - 1),
      y1 = Math.min(height - 1, Math.ceil(o.y + o.h));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = (y * width + x) * 4;
        const inside = x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h;
        const dark = darkness(data[i], data[i + 1], data[i + 2]);
        // Pixels clearly darker than the flattened overlay are opaque foreground artwork sitting over
        // (outside) or on top of (inside) the panel — e.g. a gold ornament painted on the box. Leaving
        // them untouched keeps that artwork opaque instead of dissolving it into the overlay colour.
        if (dark > blendedDark + 3) continue;
        if (isWhite(data, i)) continue;
        const coverage = clamp01(dark / blendedDark);
        if (coverage < 0.02) continue;
        out[i] = o.rgb[0];
        out[i + 1] = o.rgb[1];
        out[i + 2] = o.rgb[2];
        out[i + 3] = Math.round(255 * o.alpha * coverage);
        handled[y * width + x] = 1;
      }
    }
  }

  const whiteAt = (x: number, y: number) =>
    x >= 0 &&
    y >= 0 &&
    x < width &&
    y < height &&
    isWhite(data, (y * width + x) * 4);
  const touchesWhite = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if ((dx || dy) && whiteAt(x + dx, y + dy)) return true;
    return false;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x,
        i = p * 4;
      if (handled[p]) continue;
      if (isWhite(data, i)) {
        out[i + 3] = 0;
        continue;
      }
      if (data[i + 3] !== 255 || !touchesWhite(x, y)) continue;

      // Edge pixel: a blend of white and the shape next to it. Find that shape's colour from a solid neighbour.
      let best: [number, number, number] | null = null,
        bestDist = -1;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = ny * width + nx,
            ni = n * 4;
          if (handled[n] || isWhite(data, ni) || touchesWhite(nx, ny)) continue;
          const d = distFromWhite(data[ni], data[ni + 1], data[ni + 2]);
          if (d > bestDist) {
            bestDist = d;
            best = [data[ni], data[ni + 1], data[ni + 2]];
          }
        }
      }
      if (!best) continue; // a feature thinner than the search window: leave it opaque
      const alpha = clamp01(
        distFromWhite(data[i], data[i + 1], data[i + 2]) /
          distFromWhite(...best),
      );
      out[i] = best[0];
      out[i + 1] = best[1];
      out[i + 2] = best[2];
      out[i + 3] = Math.round(255 * alpha);
    }
  }
  return out;
}

export function cutoutStats(data: Uint8ClampedArray): CutoutStats {
  const stats = { transparent: 0, semiTransparent: 0, opaque: 0 };
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] === 0) stats.transparent++;
    else if (data[i] < 255) stats.semiTransparent++;
    else stats.opaque++;
  }
  return stats;
}

/** Composites RGBA data over a solid colour. Used by tests to prove the cutout loses nothing. */
export function compositeOver(
  data: Uint8ClampedArray,
  background: [number, number, number],
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    for (let c = 0; c < 3; c++)
      out[i + c] = Math.round(data[i + c] * a + background[c] * (1 - a));
    out[i + 3] = 255;
  }
  return out;
}

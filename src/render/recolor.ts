/**
 * Recolours a card frame from one colour variant to another without redrawing it.
 *
 * A frame has two coloured regions: the title banner (a radial gradient between a light and a dark colour) and the
 * description panel (one translucent colour). Everything else, such as the black outline and the cost and power badges, is shared by all
 * variants and is left alone.
 *
 * Banner: every banner pixel lies on the straight line between the source variant's light and dark colours, so its
 * position on that line says how far into the gradient it is. The pixel is given the colour at the same position on
 * the target variant's line. The shape, the anti-aliased edges and the alpha are untouched.
 * Description: the pixels keep their shape but take the target's colour, and the alpha is rescaled by the ratio of
 * the target's opacity to the source's.
 *
 * Works on plain RGBA arrays (not premultiplied) so it can be tested without an image library.
 */

export type Rgb = [number, number, number];

export interface FramePalette {
  titleLight: Rgb;
  titleDark: Rgb;
  descRgb: Rgb;
  /** 0 to 1. */
  descAlpha: number;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameRegions {
  banner: PixelRect;
  description: PixelRect;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Parses `#RGB`, `#RRGGBB`, `rgb(r, g, b)` or `rgba(r, g, b, a)`. */
export function parseColor(css: string): { rgb: Rgb; alpha: number } {
  const text = css.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return { rgb: [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)], alpha: 1 };
  }
  const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(text);
  if (fn) return { rgb: [+fn[1], +fn[2], +fn[3]], alpha: fn[4] === undefined ? 1 : parseFloat(fn[4]) };
  throw new Error(`Cannot read the colour "${css}"`);
}

export function paletteFromColors(colors: { titleLight: string; titleDark: string; descFill: string }): FramePalette {
  const fill = parseColor(colors.descFill);
  return { titleLight: parseColor(colors.titleLight).rgb, titleDark: parseColor(colors.titleDark).rgb, descRgb: fill.rgb, descAlpha: fill.alpha };
}

const lerp = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((c) => Math.round(a[c] + (b[c] - a[c]) * t)) as Rgb;

/** How far a colour is from a straight line between two colours: the position along it (0 to 1) and the distance. */
function projectOnLine(p: Rgb, a: Rgb, b: Rgb): { t: number; distance: number } {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  if (len2 === 0) return { t: 0, distance: Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]) };
  const t = clamp01(((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / len2);
  return { t, distance: Math.hypot(p[0] - (a[0] + ab[0] * t), p[1] - (a[1] + ab[1] * t), p[2] - (a[2] + ab[2] * t)) };
}

/** Banner pixels may drift from the gradient line by a few levels (rounding); anything further is not banner. */
const BANNER_TOLERANCE = 14;

export function recolorFrame(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  regions: FrameRegions,
  from: FramePalette,
  to: FramePalette,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data);
  const bounds = (r: PixelRect, pad: number) => ({
    x0: Math.max(0, Math.floor(r.x) - pad),
    x1: Math.min(width - 1, Math.ceil(r.x + r.width) + pad),
    y0: Math.max(0, Math.floor(r.y) - pad),
    y1: Math.min(height - 1, Math.ceil(r.y + r.height) + pad),
  });

  const banner = bounds(regions.banner, 3);
  for (let y = banner.y0; y <= banner.y1; y++) {
    for (let x = banner.x0; x <= banner.x1; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] === 0) continue;
      const { t, distance } = projectOnLine([data[i], data[i + 1], data[i + 2]], from.titleLight, from.titleDark);
      if (distance > BANNER_TOLERANCE) continue; // the outline, the description panel or anything else
      const [r, g, b] = lerp(to.titleLight, to.titleDark, t);
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
    }
  }

  // The description panel is the only translucent, non-edge part of the frame in this area. Its edge pixels have
  // lower alpha still, and their colour is the least reliable, so anything translucent up to the panel's own
  // opacity counts. The opaque banner above it and the opaque outline are left alone.
  const description = bounds(regions.description, 2);
  const fromAlpha = Math.round(from.descAlpha * 255);
  const ratio = to.descAlpha / from.descAlpha;
  for (let y = description.y0; y <= description.y1; y++) {
    for (let x = description.x0; x <= description.x1; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];
      if (a === 0 || a > fromAlpha + 4) continue;
      out[i] = to.descRgb[0];
      out[i + 1] = to.descRgb[1];
      out[i + 2] = to.descRgb[2];
      out[i + 3] = Math.min(255, Math.round(a * ratio));
    }
  }
  return out;
}

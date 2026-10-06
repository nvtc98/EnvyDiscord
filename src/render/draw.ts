import type { Canvas, SKRSContext2D } from "@napi-rs/canvas";
import { cardText } from "../engine/abilities";
import type { CardDef, Rarity } from "../engine/types";
import {
  DEFAULT_VARIANT,
  getVariant,
  type Variant,
  type VariantId,
} from "../data/variants";
import type { MapView } from "../story/types";
import type { AvatarImage } from "./avatar";
import { mulberry32 } from "../util/rng";
import type { CardLayout, Rect, TextField } from "./layout";
import {
  CARD_FONT,
  DEFAULT_BORDER,
  FONT_FAMILY,
  PALETTE,
  RARITY_COLOR,
  TITLE_FONT,
} from "./theme";

/** The variant's colours, falling back to metal for an unknown id. */
const paletteOf = (id: VariantId): Variant["colors"] =>
  (getVariant(id) ?? getVariant(DEFAULT_VARIANT)!).colors;

type Ctx = SKRSContext2D;
type Art = Canvas | null;

const body = (weight: 400 | 700, size: number) =>
  `${weight} ${size}px ${FONT_FAMILY}`;
const heading = (size: number) => `700 ${size}px ${TITLE_FONT}`;
const cardFont = (weight: 400 | 700) => (size: number) =>
  `${weight} ${size}px ${CARD_FONT}`;

function roundRect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function polygon(
  ctx: Ctx,
  rect: Rect,
  points: readonly (readonly [number, number])[],
): void {
  ctx.beginPath();
  points.forEach(([px, py], i) => {
    const x = rect.x + px * rect.width;
    const y = rect.y + py * rect.height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

// Shapes taken from the Dextrous layout's clip-paths.
const OCTAGON = [
  [0.85, 0.85],
  [0.5, 1],
  [0.15, 0.85],
  [0, 0.5],
  [0.15, 0.15],
  [0.5, 0],
  [0.85, 0.15],
  [1, 0.5],
] as const;
const BANNER = [
  [0.05, 0],
  [0.95, 0],
  [1, 0.5],
  [0.95, 1],
  [0.05, 1],
  [0, 0.5],
] as const;

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Shrinks the font until `text` fits in `maxWidth`. Returns the final size. */
function fitFont(
  ctx: Ctx,
  text: string,
  font: (size: number) => string,
  size: number,
  maxWidth: number,
  min = 7,
): number {
  let s = size;
  ctx.font = font(s);
  while (s > min && ctx.measureText(text).width > maxWidth) {
    s -= 0.5;
    ctx.font = font(s);
  }
  return s;
}

function wrapLines(ctx: Ctx, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const trial = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(trial).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Text with a dark outline so it stays readable on any art. */
function strokedText(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, size * 0.16);
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

const anchorX = (f: TextField): number =>
  f.align === "center"
    ? f.x + f.width / 2
    : f.align === "left"
      ? f.x + (f.padding ?? 0)
      : f.x + f.width - (f.padding ?? 0);

function drawLine(
  ctx: Ctx,
  f: TextField,
  text: string,
  font: (weight: 400 | 700) => (size: number) => string,
  color = f.color,
  outline = true,
): void {
  const pad = f.padding ?? 3;
  const size = fitFont(
    ctx,
    text,
    font(f.weight),
    f.fontSize,
    f.width - pad * 2,
  );
  ctx.textAlign = f.align;
  ctx.textBaseline = "middle";
  const x = anchorX(f);
  const y = f.y + f.height / 2 + size * 0.04;
  if (outline) {
    strokedText(ctx, text, x, y, size, color);
  } else {
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }
}

function drawParagraph(ctx: Ctx, f: TextField, text: string): void {
  if (!text) return;
  const pad = f.padding ?? 4;
  const maxWidth = f.width - pad * 2;
  const lineHeight = f.lineHeight ?? 1.15;
  const maxLines = f.maxLines ?? 99;
  let size = f.fontSize;
  let lines: string[] = [];
  for (; size >= 8; size -= 0.5) {
    ctx.font = cardFont(f.weight)(size);
    lines = wrapLines(ctx, text, maxWidth);
    if (
      lines.length <= maxLines &&
      lines.length * size * lineHeight <= f.height - pad * 2
    )
      break;
  }
  ctx.textBaseline = "middle";
  const total = lines.length * size * lineHeight;
  const top = f.y + f.height / 2 - total / 2 + (size * lineHeight) / 2;
  // A leading "Active:" / "Passive:" is drawn in bold; the rest of the text stays regular.
  // The prefix only ever sits on the first wrapped line, so bold just the matching leading
  // span of line 0 and keep every other line plain.
  const prefixMatch = /^(Active:|Passive:)(\s*)(.*)$/.exec(lines[0] ?? "");
  const regular = cardFont(400)(size);
  const bold = cardFont(700)(size);
  lines.forEach((line, i) => {
    const y = top + i * size * lineHeight;
    if (i === 0 && prefixMatch) {
      // Measure the bold prefix and the regular remainder so the whole line stays centred.
      const [, prefix, gap, rest] = prefixMatch;
      const head = prefix + gap;
      ctx.font = bold;
      const headW = ctx.measureText(head).width;
      ctx.font = regular;
      const restW = ctx.measureText(rest).width;
      const lineW = headW + restW;
      let x =
        f.align === "center"
          ? anchorX(f) - lineW / 2
          : f.align === "right"
            ? anchorX(f) - lineW
            : anchorX(f);
      ctx.textAlign = "left";
      ctx.fillStyle = f.color;
      ctx.font = bold;
      ctx.fillText(head, x, y);
      ctx.font = regular;
      ctx.fillText(rest, x + headW, y);
      return;
    }
    ctx.textAlign = f.align;
    ctx.font = regular;
    ctx.fillStyle = f.color;
    ctx.fillText(line, anchorX(f), y);
  });
}

/**
 * Fraction of the vertical overflow trimmed off the very TOP of cover-scaled art, so the crop window
 * anchors near the top of the picture (a small 10% margin shaved) instead of centring. One source of
 * truth, shared by every art draw (full card, compact card -> battle board/hand/book, /card, /collection).
 */
export const ART_CROP_TOP = 0.2;

/**
 * Vertical draw `y` for cover-scaled art of height `drawnHeight` placed into a rect at `rY` of height
 * `rHeight`. When the art is NOT taller than the rect (overflow <= 0) it keeps the centred offset
 * `rY + (rHeight - drawnHeight) / 2`. When it IS taller (overflow > 0) it slides the art UP by
 * `ART_CROP_TOP` of the overflow — `rY - ART_CROP_TOP * overflow` — so the visible window starts
 * ~10% down from the art's top. The result is clamped to `[rY - overflow, rY]` so the art always
 * fully covers the rect (never shows above its top or below its bottom), staying safe even if
 * ART_CROP_TOP is later tuned outside [0, 1].
 */
export function artCropOffset(
  rY: number,
  rHeight: number,
  drawnHeight: number,
): number {
  const overflow = drawnHeight - rHeight;
  if (overflow <= 0) return rY + (rHeight - drawnHeight) / 2;
  return Math.min(rY, Math.max(rY - overflow, rY - ART_CROP_TOP * overflow));
}

/** Real art if there is a file, otherwise a murky gradient whose hue comes from the card id, so every card looks different. */
export function drawArt(
  ctx: Ctx,
  art: Art,
  face: { id: string; name: string },
  r: Rect,
): void {
  if (art) {
    const scale = Math.max(r.width / art.width, r.height / art.height);
    const dw = art.width * scale;
    const dh = art.height * scale;
    ctx.drawImage(
      art,
      r.x + (r.width - dw) / 2,
      artCropOffset(r.y, r.height, dh),
      dw,
      dh,
    );
    return;
  }
  const h = hash(face.id);
  const hue = h % 360;
  const g = ctx.createLinearGradient(r.x, r.y + r.height, r.x + r.width, r.y);
  g.addColorStop(0, `hsl(${hue}, 36%, 14%)`);
  g.addColorStop(1, `hsl(${(hue + 32) % 360}, 42%, 34%)`);
  ctx.fillStyle = g;
  ctx.fillRect(r.x, r.y, r.width, r.height);

  const rng = mulberry32(h);
  for (let i = 0; i < 7; i++) {
    const cx = r.x + rng() * r.width;
    const cy = r.y + rng() * r.height;
    const radius = r.width * (0.1 + rng() * 0.3);
    const haze = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    haze.addColorStop(0, `rgba(230,223,208,${0.05 + rng() * 0.07})`);
    haze.addColorStop(1, "rgba(230,223,208,0)");
    ctx.fillStyle = haze;
    ctx.fillRect(r.x, r.y, r.width, r.height);
  }
  ctx.save();
  ctx.globalAlpha = 0.13;
  ctx.fillStyle = PALETTE.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.min(r.width, r.height) * 0.62}px ${CARD_FONT}`;
  ctx.fillText(
    face.name.charAt(0).toUpperCase(),
    r.x + r.width / 2,
    r.y + r.height * 0.44,
  );
  ctx.restore();
}

function vignette(ctx: Ctx, r: Rect): void {
  const g = ctx.createRadialGradient(
    r.x + r.width / 2,
    r.y + r.height / 2,
    Math.min(r.width, r.height) * 0.3,
    r.x + r.width / 2,
    r.y + r.height / 2,
    Math.max(r.width, r.height) * 0.75,
  );
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = g;
  ctx.fillRect(r.x, r.y, r.width, r.height);
}

/** The title banner's radial gradient, coloured by the variant (light centre -> dark edge), clipped to the banner. */
function bannerFill(ctx: Ctx, r: Rect, colors: Variant["colors"]): void {
  // Dextrous: radial-gradient(<light> 11%, <dark> 100%), stretched to the banner's shape.
  ctx.save();
  polygon(ctx, r, BANNER);
  ctx.clip();
  ctx.translate(r.x + r.width / 2, r.y + r.height / 2);
  ctx.scale(1, r.height / r.width);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, (r.width / 2) * 1.2);
  g.addColorStop(0.11, colors.titleLight);
  g.addColorStop(1, colors.titleDark);
  ctx.fillStyle = g;
  ctx.fillRect(-r.width, -r.width, r.width * 2, r.width * 2);
  ctx.restore();
}

/** The frame drawn in code, used when `assets/frames/variant-<id>.png` does not exist. Coloured by the variant. */
function drawBuiltInFrame(
  ctx: Ctx,
  layout: CardLayout,
  variant: VariantId,
): void {
  const { width: w, height: h, cornerRadius } = layout.card;
  const colors = paletteOf(variant);
  roundRect(ctx, 2.5, 2.5, w - 5, h - 5, cornerRadius);
  ctx.lineWidth = 5;
  ctx.strokeStyle = DEFAULT_BORDER;
  ctx.stroke();
  ctx.fillStyle = "#000";
  polygon(ctx, layout.fields.cost, OCTAGON);
  ctx.fill();
  polygon(ctx, layout.fields.power, OCTAGON);
  ctx.fill();
  bannerFill(ctx, layout.fields.name, colors);
  const d = layout.fields.description;
  ctx.fillStyle = colors.descFill;
  ctx.fillRect(d.x, d.y, d.width, d.height);
}

export interface FullFace {
  def: CardDef;
  /** The colour variant to draw. */
  variant: VariantId;
  /** Small label at the top, e.g. "NEW" or "Blue". */
  badge?: string;
}

/** Layer 1: art, clipped to the card's rounded outline. Layer 2: the frame (transparent PNG). Layer 3: text. */
export function drawFullCard(
  ctx: Ctx,
  layout: CardLayout,
  face: FullFace,
  art: Art,
  frame: Canvas | null,
): void {
  const { width: w, height: h, cornerRadius } = layout.card;

  ctx.save();
  roundRect(ctx, 0, 0, w, h, cornerRadius);
  ctx.clip();
  drawArt(ctx, art, face.def, layout.art);
  ctx.restore();

  if (frame) {
    ctx.save();
    ctx.globalAlpha = layout.frame.opacity;
    ctx.drawImage(frame, 0, 0, w, h);
    ctx.restore();
  } else {
    drawBuiltInFrame(ctx, layout, face.variant);
  }

  const f = layout.fields;
  // The card title (name) is drawn without a dark outline; cost and power keep theirs.
  drawLine(ctx, f.name, face.def.name, cardFont, f.name.color, false);
  drawParagraph(ctx, f.description, cardText(face.def));
  drawLine(ctx, f.cost, String(face.def.cost), cardFont);
  drawLine(ctx, f.power, String(face.def.power), cardFont);

  if (face.badge) {
    ctx.font = cardFont(700)(8);
    const bw = ctx.measureText(face.badge).width + 12;
    const bx = w / 2 - bw / 2;
    roundRect(ctx, bx, 7, bw, 14, 7);
    ctx.fillStyle = PALETTE.gold;
    ctx.fill();
    ctx.fillStyle = "#1a1208";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(face.badge, w / 2, 14.5);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

// ---- Compact cards: what sits on the board and in the hand ----

export const COMPACT = { w: 196, h: 118 } as const;

export interface CompactFace {
  id: string;
  name: string;
  cost: number;
  /** Power it deals right now (after buffs and lane effects). */
  power: number;
  basePower: number;
  /** The colour variant to draw. */
  variant: VariantId;
  hasAbility: boolean;
  owner?: "mine" | "theirs";
  /** 1-based number shown on hand cards; matches the select menu. */
  index?: number;
  selected?: boolean;
  dim?: boolean;
  /** Bargain and eternal cards get a coloured line and a gem. */
  rarity?: Rarity;
}

export function drawCompactCard(ctx: Ctx, face: CompactFace, art: Art): void {
  const { w, h } = COMPACT;
  const radius = 8;

  ctx.save();
  roundRect(ctx, 0, 0, w, h, radius);
  ctx.clip();
  drawArt(ctx, art, face, { x: 0, y: 0, width: w, height: h });
  vignette(ctx, { x: 0, y: 0, width: w, height: h });
  ctx.restore();

  // Border: a neutral dark line; an inner line shows who owns the card.
  roundRect(ctx, 2, 2, w - 4, h - 4, radius - 1);
  ctx.lineWidth = 4;
  ctx.strokeStyle = DEFAULT_BORDER;
  ctx.stroke();
  const rarityColor =
    face.rarity === "eternal" || face.rarity === "bargain"
      ? RARITY_COLOR[face.rarity]
      : null;
  const innerColor = face.owner
    ? face.owner === "mine"
      ? PALETTE.mine
      : PALETTE.theirs
    : rarityColor;
  if (innerColor) {
    roundRect(ctx, 4.5, 4.5, w - 9, h - 9, radius - 3);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = innerColor;
    ctx.stroke();
  }
  if (rarityColor && face.index === undefined) {
    ctx.save();
    ctx.translate(w / 2, 13);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = rarityColor;
    ctx.shadowColor = rarityColor;
    ctx.shadowBlur = 8;
    ctx.fillRect(-5, -5, 10, 10);
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "#000";
    ctx.strokeRect(-5, -5, 10, 10);
    ctx.restore();
  }

  const banner: Rect = { x: 8, y: h - 28, width: w - 16, height: 21 };
  bannerFill(ctx, banner, paletteOf(face.variant));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const size = fitFont(ctx, face.name, cardFont(700), 12, banner.width - 16);
  ctx.fillStyle = "#fff";
  ctx.fillText(
    face.name,
    banner.x + banner.width / 2,
    banner.y + banner.height / 2 + size * 0.04,
  );

  const cost: Rect = { x: -5, y: -5, width: 34, height: 34 };
  const power: Rect = { x: w - 29, y: -5, width: 34, height: 34 };
  ctx.fillStyle = "#000";
  polygon(ctx, cost, OCTAGON);
  ctx.fill();
  polygon(ctx, power, OCTAGON);
  ctx.fill();
  ctx.font = cardFont(700)(15);
  ctx.fillStyle = PALETTE.energy;
  ctx.fillText(
    String(face.cost),
    cost.x + cost.width / 2,
    cost.y + cost.height / 2 + 1,
  );
  ctx.fillStyle =
    face.power > face.basePower
      ? "#74e6a1"
      : face.power < face.basePower
        ? "#ff8080"
        : "#fff";
  ctx.fillText(
    String(face.power),
    power.x + power.width / 2,
    power.y + power.height / 2 + 1,
  );

  if (face.hasAbility) {
    ctx.save();
    ctx.translate(14, h - 38);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = PALETTE.gold;
    ctx.fillRect(-4, -4, 8, 8);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#000";
    ctx.strokeRect(-4, -4, 8, 8);
    ctx.restore();
  }

  if (face.index !== undefined) {
    ctx.beginPath();
    ctx.arc(w / 2, 14, 10, 0, Math.PI * 2);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = PALETTE.gold;
    ctx.stroke();
    ctx.font = body(700, 12);
    ctx.fillStyle = PALETTE.gold;
    ctx.fillText(String(face.index), w / 2, 14.5);
  }

  if (face.dim) {
    roundRect(ctx, 0, 0, w, h, radius);
    ctx.fillStyle = "rgba(5,4,8,0.55)";
    ctx.fill();
  }
  if (face.selected) {
    roundRect(ctx, -1, -1, w + 2, h + 2, radius + 1);
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = PALETTE.gold;
    ctx.shadowColor = PALETTE.gold;
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** An empty board cell. */
export function drawEmptyCell(ctx: Ctx): void {
  roundRect(ctx, 0, 0, COMPACT.w, COMPACT.h, 8);
  ctx.fillStyle = "rgba(255,255,255,0.025)";
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = "rgba(201,151,58,0.2)";
  ctx.stroke();
  ctx.setLineDash([]);
}

// ---- Scene pieces ----

/** The arena backdrop: darkness, cold light for you, ember light for the enemy, a faint ritual circle in the middle. */
export function drawArena(
  ctx: Ctx,
  w: number,
  h: number,
  circleY: number,
  seed: number,
): void {
  const base = ctx.createLinearGradient(0, 0, w, h);
  base.addColorStop(0, "#050408");
  base.addColorStop(1, "#130a14");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  const glow = (cx: number, cy: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
  glow(w * 0.5, circleY + 190, w * 0.55, "rgba(40,62,110,0.3)");
  glow(w * 0.5, circleY - 190, w * 0.55, "rgba(120,24,40,0.3)");

  ctx.save();
  ctx.translate(w / 2, circleY);
  ctx.strokeStyle = "rgba(201,151,58,0.1)";
  for (const [radius, width] of [
    [170, 1.5],
    [158, 1],
    [110, 1],
  ] as const) {
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 158, Math.sin(a) * 158);
    ctx.lineTo(
      Math.cos(a) * (i % 2 ? 164 : 170),
      Math.sin(a) * (i % 2 ? 164 : 170),
    );
    ctx.stroke();
  }
  ctx.restore();

  const rng = mulberry32(seed);
  for (let i = 0; i < 70; i++) {
    ctx.beginPath();
    ctx.arc(rng() * w, rng() * h, 0.6 + rng() * 1.3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(230,223,208,${0.04 + rng() * 0.12})`;
    ctx.fill();
  }

  const edge = ctx.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.4,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.8,
  );
  edge.addColorStop(0, "rgba(0,0,0,0)");
  edge.addColorStop(1, "rgba(0,0,0,0.7)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, h);
}

const hpColor = (ratio: number) =>
  ratio > 0.5 ? PALETTE.hpHigh : ratio > 0.25 ? PALETTE.hpMid : PALETTE.hpLow;

export interface HudData {
  label: string;
  color: string;
  hp: number;
  maxHp: number;
  hand: number;
  deck: number;
  /** Only the viewer's own energy is shown. */
  energy?: { current: number; max: number };
}

/** A player's strip: name, HP bar and (for the viewer) energy pips. Drawn at the origin, `width` wide, 56 tall. */
export function drawHud(ctx: Ctx, d: HudData, width: number): void {
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = heading(15);
  ctx.fillStyle = d.color;
  // HUD labels render in all-caps; callers pass the raw name and drawHud uppercases here.
  ctx.fillText(d.label.toUpperCase(), 0, 14);

  ctx.font = body(400, 12);
  ctx.fillStyle = PALETTE.muted;
  ctx.textAlign = "right";
  ctx.fillText(`HAND ${d.hand}  ·  DECK ${d.deck}`, width, 14);

  const barY = 22;
  const barW = width * 0.52;
  const ratio = Math.max(0, Math.min(1, d.hp / d.maxHp));
  roundRect(ctx, 0, barY, barW, 15, 4);
  ctx.fillStyle = PALETTE.inset;
  ctx.fill();
  if (ratio > 0) {
    ctx.save();
    roundRect(ctx, 0, barY, barW, 15, 4);
    ctx.clip();
    ctx.fillStyle = hpColor(ratio);
    ctx.fillRect(0, barY, Math.max(15, barW * ratio), 15);
    ctx.restore();
  }
  roundRect(ctx, 0, barY, barW, 15, 4);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(201,151,58,0.35)";
  ctx.stroke();
  ctx.textAlign = "left";
  ctx.font = body(700, 13);
  ctx.fillStyle = PALETTE.text;
  ctx.fillText(`${Math.max(0, d.hp)} / ${d.maxHp} HP`, barW + 10, barY + 12.5);

  if (d.energy) {
    const pip = 15;
    const x0 = width - 9 * (pip + 3) + 3;
    for (let i = 0; i < 9; i++) {
      const cx = x0 + i * (pip + 3) + pip / 2;
      const cy = barY + 8;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.rect(-5, -5, 10, 10);
      if (i < d.energy.current) {
        ctx.fillStyle = PALETTE.energy;
        ctx.fill();
      } else if (i < d.energy.max) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = PALETTE.energy;
        ctx.stroke();
      } else {
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(255,255,255,0.14)";
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.textAlign = "right";
    ctx.font = body(700, 12);
    ctx.fillStyle = PALETTE.energy;
    ctx.fillText(
      `ENERGY ${d.energy.current}/${d.energy.max}`,
      width,
      barY + 36,
    );
  }
  ctx.textAlign = "left";
}

/** Small label above a lane, with optional modifier tags such as "x2" or "ANCHORED". */
export function drawLaneHeader(
  ctx: Ctx,
  name: string,
  tags: readonly string[],
  width: number,
): void {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = heading(13);
  ctx.fillStyle = PALETTE.textSoft;
  ctx.fillText(name.toUpperCase(), 2, 14);
  ctx.textAlign = "right";
  ctx.font = body(700, 10);
  ctx.fillStyle = PALETTE.gold;
  ctx.fillText(tags.join("   "), width - 2, 14);
  ctx.textAlign = "left";
}

/**
 * A circular avatar: the image cover-scaled and center-cropped into a circle with a coloured ring,
 * or a themed eye-motif placeholder when no image is given. Drawn centred at (cx, cy).
 */
export function drawAvatar(
  ctx: Ctx,
  cx: number,
  cy: number,
  size: number,
  image: AvatarImage | null,
  ringColor: string,
): void {
  const r = size / 2;
  if (image) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    // Cover-scale and centre-crop, mirroring drawArt's cover math.
    const scale = Math.max(size / image.width, size / image.height);
    const dw = image.width * scale;
    const dh = image.height * scale;
    ctx.drawImage(image, cx - dw / 2, cy - dh / 2, dw, dh);
    ctx.restore();
  } else {
    // Placeholder: a low-alpha disc in the side colour with the themed eye glyph.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = ringColor;
    ctx.globalAlpha = 0.18;
    ctx.fill();
    ctx.restore();
    drawEye(ctx, cx, cy, size * 0.72, ringColor);
  }
  // The ring on top of either path.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = ringColor;
  ctx.stroke();
}

/** An almond-shaped eye with an iris, the mark used for every place on the map. */
export function drawEye(
  ctx: Ctx,
  cx: number,
  cy: number,
  width: number,
  iris: string,
): void {
  const h = width * 0.5;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(-width / 2, 0);
  ctx.quadraticCurveTo(0, -h, width / 2, 0);
  ctx.quadraticCurveTo(0, h, -width / 2, 0);
  ctx.closePath();
  ctx.fillStyle = "#120d16";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = PALETTE.gold;
  ctx.stroke();
  ctx.save();
  ctx.clip();
  ctx.beginPath();
  ctx.arc(0, 0, width * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = iris;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, width * 0.085, 0, Math.PI * 2);
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-width * 0.06, -width * 0.06, width * 0.03, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

/** A simple map: places as eyes joined by dashed paths, with a marker where the player stands. Coordinates are 0 to 1. */
export function drawMap(ctx: Ctx, w: number, h: number, map: MapView): void {
  const at = (id: string) => {
    const l = map.locations.find((loc) => loc.id === id);
    return l ? { x: l.x * w, y: l.y * h } : null;
  };

  ctx.setLineDash([9, 8]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(201,151,58,0.5)";
  for (const [a, b] of map.links) {
    const p = at(a);
    const q = at(b);
    if (!p || !q) continue;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  for (const loc of map.locations) {
    const x = loc.x * w;
    const y = loc.y * h;
    if (loc.here) {
      const glow = ctx.createRadialGradient(x, y, 10, x, y, 62);
      glow.addColorStop(0, "rgba(201,151,58,0.38)");
      glow.addColorStop(1, "rgba(201,151,58,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(x - 70, y - 70, 140, 140);
      ctx.beginPath();
      ctx.arc(x, y, 40, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = PALETTE.gold;
      ctx.stroke();
    }
    drawEye(ctx, x, y, 58, loc.here ? PALETTE.gold : "#8e3a4a");

    const labelX = Math.min(Math.max(x, 78), w - 78);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = heading(15);
    ctx.fillStyle = PALETTE.text;
    ctx.fillText(loc.name, labelX, y + 62);
    if (loc.here) {
      ctx.font = body(700, 11);
      ctx.fillStyle = PALETTE.gold;
      ctx.fillText("YOU ARE HERE", labelX, y - 54);
    }
  }
  ctx.textAlign = "left";
}

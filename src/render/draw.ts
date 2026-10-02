import { Path2D, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import { createFighter } from '../engine/fighter';
import type { CardDef, Element, Fighter, Rarity } from '../engine/types';
import { mulberry32 } from '../util/rng';
import { ELEMENT_STYLE, FONT_FAMILY, KIND_COLOR, RARITY_STYLE } from './theme';

type Ctx = SKRSContext2D;
type Art = Canvas | null;

const font = (weight: 400 | 700, size: number) => `${weight} ${size}px ${FONT_FAMILY}`;

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Shrinks the font until `text` fits in `maxWidth`. */
function fitFont(ctx: Ctx, text: string, weight: 400 | 700, size: number, maxWidth: number): void {
  let s = size;
  ctx.font = font(weight, s);
  while (s > 9 && ctx.measureText(text).width > maxWidth) {
    s -= 1;
    ctx.font = font(weight, s);
  }
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function borderStyle(ctx: Ctx, rarity: Rarity, w: number, h: number): string | CanvasGradient {
  if (rarity !== 'legendary') return RARITY_STYLE[rarity].color;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#fde68a');
  g.addColorStop(0.5, '#f59e0b');
  g.addColorStop(1, '#b45309');
  return g;
}

function drawIcon(ctx: Ctx, element: Element, cx: number, cy: number, size: number, color: string): void {
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = color;
  ctx.fill(new Path2D(ELEMENT_STYLE[element].icon));
  ctx.restore();
}

function drawElementBadge(ctx: Ctx, element: Element, cx: number, cy: number, r: number): void {
  const style = ELEMENT_STYLE[element];
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, style.light);
  g.addColorStop(1, style.accent);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.stroke();
  drawIcon(ctx, element, cx, cy, r * 1.25, '#ffffff');
}

/** Real art if the file exists, otherwise a per-element gradient with a unique bokeh pattern. */
function drawArtBox(
  ctx: Ctx,
  art: Art,
  face: { id: string; element: Element },
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();

  if (art) {
    const scale = Math.max(w / art.width, h / art.height);
    const dw = art.width * scale;
    const dh = art.height * scale;
    ctx.drawImage(art, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  } else {
    const style = ELEMENT_STYLE[face.element];
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, style.dark);
    g.addColorStop(1, style.light);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);

    const rng = mulberry32(hash(face.id));
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.arc(x + rng() * w, y + rng() * h, 10 + rng() * Math.min(w, h) * 0.25, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.04 + rng() * 0.08})`;
      ctx.fill();
    }
    ctx.globalAlpha = 0.3;
    drawIcon(ctx, face.element, x + w / 2, y + h / 2, Math.min(w, h) * 0.6, '#ffffff');
    ctx.globalAlpha = 1;
  }

  ctx.restore();
  roundRect(ctx, x, y, w, h, r);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.stroke();
}

function drawPill(ctx: Ctx, text: string, x: number, y: number, h: number, bg: string, fg: string, size: number): number {
  ctx.font = font(700, size);
  const w = ctx.measureText(text).width + h * 0.9;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.fillText(text, x + w / 2, y + h / 2 + size * 0.35);
  ctx.textAlign = 'left';
  return w;
}

function badgeColor(text: string): string {
  if (text.startsWith('NEW')) return '#22c55e';
  if (text.startsWith('LV')) return '#fbbf24';
  return '#cbd5e1';
}

export const FULL_W = 300;
export const FULL_H = 420;

/** Collection-style card, drawn into a 300x420 box at the current origin. */
export function drawFullCard(ctx: Ctx, def: CardDef, level: number, art: Art, badge?: string): void {
  const stats = createFighter(def, level);
  const rarity = RARITY_STYLE[def.rarity];

  roundRect(ctx, 0, 0, FULL_W, FULL_H, 18);
  ctx.fillStyle = '#151925';
  ctx.fill();
  roundRect(ctx, 2.5, 2.5, FULL_W - 5, FULL_H - 5, 16);
  ctx.lineWidth = 5;
  ctx.strokeStyle = borderStyle(ctx, def.rarity, FULL_W, FULL_H);
  ctx.stroke();

  ctx.fillStyle = '#f8fafc';
  ctx.textAlign = 'left';
  fitFont(ctx, def.name, 700, 22, 205);
  ctx.fillText(def.name, 18, 38);
  drawElementBadge(ctx, def.element, 262, 29, 17);

  drawArtBox(ctx, art, def, 14, 54, 272, 204, 10);
  if (badge) drawPill(ctx, badge, 22, 62, 22, badgeColor(badge), '#06210f', 12);

  ctx.font = font(700, 12);
  ctx.fillStyle = rarity.color;
  ctx.fillText(rarity.label, 18, 282);
  drawPill(ctx, `Lv ${level}`, 286 - 56, 268, 22, rarity.color, '#111827', 12);

  const entries: [string, number][] = [
    ['HP', stats.maxHp],
    ['ATK', stats.atk],
    ['DEF', stats.def],
    ['SPD', stats.spd],
  ];
  entries.forEach(([label, value], i) => {
    const x = 14 + i * (63 + 6.67);
    roundRect(ctx, x, 298, 63, 44, 8);
    ctx.fillStyle = '#202637';
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.font = font(700, 10);
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(label, x + 31.5, 314);
    ctx.font = font(700, 18);
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(String(value), x + 31.5, 334);
  });

  def.skills.forEach((skill, i) => {
    const y = 366 + i * 20;
    ctx.beginPath();
    ctx.arc(24, y - 4, 5, 0, Math.PI * 2);
    ctx.fillStyle = KIND_COLOR[skill.kind];
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#e2e8f0';
    fitFont(ctx, skill.name, 400, 13, 150);
    ctx.fillText(skill.name, 36, y);

    const effect = skill.kind === 'attack' ? `x${skill.power}` : `${Math.round(skill.power * 100)}%`;
    const detail = skill.cooldown > 0 ? `${effect} · CD ${skill.cooldown}` : effect;
    ctx.textAlign = 'right';
    ctx.font = font(400, 11);
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(detail, 286, y);
  });
  ctx.textAlign = 'left';
}

interface Layout {
  w: number;
  h: number;
  pad: number;
  radius: number;
  border: number;
  name: number;
  badge: number;
  artY: number;
  artH: number;
  lvl: number;
  hpText: number;
  hpTextY: number;
  barY: number;
  barH: number;
  stats: number | null;
  statsY: number;
}

export const LARGE: Layout = {
  w: 240, h: 336, pad: 10, radius: 14, border: 5, name: 18, badge: 14,
  artY: 40, artH: 196, lvl: 12, hpText: 16, hpTextY: 262, barY: 270, barH: 18, stats: 12, statsY: 322,
};
export const COMPACT: Layout = {
  w: 156, h: 204, pad: 7, radius: 10, border: 4, name: 14, badge: 10,
  artY: 28, artH: 112, lvl: 11, hpText: 13, hpTextY: 158, barY: 163, barH: 13, stats: null, statsY: 0,
};

function hpColor(ratio: number): string {
  return ratio > 0.5 ? '#22c55e' : ratio > 0.25 ? '#eab308' : '#ef4444';
}

/** In-battle card: art, HP bar, shield. Drawn at the current origin. */
export function drawBattleCard(
  ctx: Ctx,
  fighter: Fighter,
  rarity: Rarity,
  art: Art,
  L: Layout,
  active: boolean,
): void {
  const color = RARITY_STYLE[rarity].color;
  const inner = L.w - L.pad * 2;

  ctx.save();
  if (active) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 26;
  }
  roundRect(ctx, 0, 0, L.w, L.h, L.radius);
  ctx.fillStyle = '#151925';
  ctx.fill();
  ctx.restore();

  roundRect(ctx, L.border / 2, L.border / 2, L.w - L.border, L.h - L.border, L.radius - 2);
  ctx.lineWidth = L.border;
  ctx.strokeStyle = borderStyle(ctx, rarity, L.w, L.h);
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#f8fafc';
  fitFont(ctx, fighter.name, 700, L.name, L.w - L.pad * 2 - L.badge * 2 - 6);
  ctx.fillText(fighter.name, L.pad + 2, L.artY - L.badge * 0.75);
  drawElementBadge(ctx, fighter.element, L.w - L.pad - L.badge, L.artY - L.badge - 3, L.badge);

  drawArtBox(ctx, art, { id: fighter.cardId, element: fighter.element }, L.pad, L.artY, inner, L.artH, L.radius - 4);
  drawPill(ctx, `Lv ${fighter.level}`, L.pad + 6, L.artY + L.artH - L.lvl * 2 - 2, L.lvl * 1.7, color, '#111827', L.lvl);

  // HP line: label + optional shield on the left, numbers on the right.
  ctx.font = font(700, L.hpText);
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'left';
  ctx.fillText('HP', L.pad + 2, L.hpTextY);
  if (fighter.shield > 0) {
    ctx.fillStyle = '#60a5fa';
    ctx.font = font(700, L.hpText - 3);
    ctx.fillText(`+${fighter.shield} SHIELD`, L.pad + 2 + L.hpText * 1.9, L.hpTextY);
  }
  ctx.textAlign = 'right';
  ctx.font = font(700, L.hpText);
  ctx.fillStyle = '#f8fafc';
  ctx.fillText(`${fighter.hp} / ${fighter.maxHp}`, L.w - L.pad - 2, L.hpTextY);

  const ratio = Math.max(0, Math.min(1, fighter.hp / fighter.maxHp));
  roundRect(ctx, L.pad, L.barY, inner, L.barH, L.barH / 2);
  ctx.fillStyle = '#0b0e14';
  ctx.fill();
  if (ratio > 0) {
    ctx.save();
    roundRect(ctx, L.pad, L.barY, inner, L.barH, L.barH / 2);
    ctx.clip();
    ctx.fillStyle = hpColor(ratio);
    ctx.fillRect(L.pad, L.barY, Math.max(L.barH, inner * ratio), L.barH);
    ctx.restore();
  }
  if (fighter.shield > 0) {
    const sh = Math.min(1, fighter.shield / fighter.maxHp);
    roundRect(ctx, L.pad, L.barY + L.barH + 4, Math.max(8, inner * sh), 6, 3);
    ctx.fillStyle = '#60a5fa';
    ctx.fill();
  }

  if (L.stats !== null) {
    ctx.textAlign = 'center';
    ctx.font = font(400, L.stats);
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`ATK ${fighter.atk}   DEF ${fighter.def}   SPD ${fighter.spd}`, L.w / 2, L.statsY);
  }

  if (fighter.hp <= 0) {
    roundRect(ctx, 0, 0, L.w, L.h, L.radius);
    ctx.fillStyle = 'rgba(8,10,16,0.76)';
    ctx.fill();
    ctx.save();
    ctx.translate(L.w / 2, L.h / 2);
    ctx.rotate(-0.21);
    ctx.textAlign = 'center';
    ctx.font = font(700, L.w * 0.26);
    ctx.fillStyle = '#ef4444';
    ctx.fillText('K.O.', 0, L.w * 0.09);
    ctx.restore();
  }
  ctx.textAlign = 'left';
}

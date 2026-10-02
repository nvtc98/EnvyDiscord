import { join } from 'node:path';
import { GlobalFonts, createCanvas } from '@napi-rs/canvas';
import type { Battle, CardDef, Rarity, Side } from '../engine/types';
import { ArtLibrary } from './art';
import { COMPACT, FULL_H, FULL_W, LARGE, drawBattleCard, drawFullCard } from './draw';
import { FONT_FAMILY } from './theme';

export interface CardView {
  def: CardDef;
  level: number;
  /** Small ribbon on the art, e.g. "NEW", "LV 3", "MAX". */
  badge?: string;
}

export interface ImageRenderer {
  /** Cards side by side in one row (daily pack, collection page, single card). */
  cards(views: CardView[], options?: { scale?: number }): Promise<Buffer>;
  /** The whole 3v3 battle scene as one image. */
  battle(battle: Battle): Promise<Buffer>;
}

export interface RendererOptions {
  /** Folder with `fonts/` and `cards/`. */
  assetsDir: string;
  cards: readonly CardDef[];
}

const GAP = 14;
const SCENE_W = 740;
const SCENE_H = 624;
const COLUMN_W = 330;

/** Throws if the native canvas module or the bundled fonts cannot be loaded; callers fall back to text. */
export async function createImageRenderer({ assetsDir, cards }: RendererOptions): Promise<ImageRenderer> {
  for (const file of ['Inter-Regular.woff2', 'Inter-Bold.woff2']) {
    const path = join(assetsDir, 'fonts', file);
    if (!GlobalFonts.registerFromPath(path, FONT_FAMILY)) throw new Error(`Could not load font ${path}`);
  }

  const art = new ArtLibrary(join(assetsDir, 'cards'));
  const byId = new Map(cards.map((c) => [c.id, c]));
  const rarityOf = (cardId: string): Rarity => byId.get(cardId)?.rarity ?? 'common';

  return {
    async cards(views, { scale = 1 } = {}) {
      const cw = Math.round(FULL_W * scale);
      const ch = Math.round(FULL_H * scale);
      const canvas = createCanvas(views.length * cw + (views.length + 1) * GAP, ch + GAP * 2);
      const ctx = canvas.getContext('2d');
      for (const [i, view] of views.entries()) {
        ctx.save();
        ctx.translate(GAP + i * (cw + GAP), GAP);
        ctx.scale(scale, scale);
        drawFullCard(ctx, view.def, view.level, await art.get(view.def.id), view.badge);
        ctx.restore();
      }
      return canvas.toBuffer('image/png');
    },

    async battle(battle) {
      const canvas = createCanvas(SCENE_W, SCENE_H);
      const ctx = canvas.getContext('2d');

      const bg = ctx.createLinearGradient(0, 0, SCENE_W, SCENE_H);
      bg.addColorStop(0, '#0f172a');
      bg.addColorStop(1, '#1e1b4b');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, SCENE_W, SCENE_H);

      const drawSide = async (side: Side, columnX: number, label: string, color: string) => {
        ctx.textAlign = 'center';
        ctx.font = `700 18px ${FONT_FAMILY}`;
        ctx.fillStyle = color;
        ctx.fillText(label, columnX + COLUMN_W / 2, 30);

        const active = side.fighters[side.active];
        ctx.save();
        ctx.translate(columnX + (COLUMN_W - LARGE.w) / 2, 44);
        drawBattleCard(ctx, active, rarityOf(active.cardId), await art.get(active.cardId), LARGE, true);
        ctx.restore();

        let slot = 0;
        for (const [index, fighter] of side.fighters.entries()) {
          if (index === side.active) continue;
          ctx.save();
          ctx.translate(columnX + 3 + slot * (COMPACT.w + 12), 394);
          drawBattleCard(ctx, fighter, rarityOf(fighter.cardId), await art.get(fighter.cardId), COMPACT, false);
          ctx.restore();
          slot += 1;
        }
      };
      await drawSide(battle.player, 20, 'YOU', '#38bdf8');
      await drawSide(battle.enemy, 20 + COLUMN_W + 40, 'ENEMY', '#f87171');

      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(248,250,252,0.85)';
      ctx.font = `700 34px ${FONT_FAMILY}`;
      ctx.fillText('VS', SCENE_W / 2, 230);
      ctx.fillStyle = '#94a3b8';
      ctx.font = `700 13px ${FONT_FAMILY}`;
      ctx.fillText(`TURN ${battle.turn}`, SCENE_W / 2, 30);

      if (battle.winner) {
        const won = battle.winner === 'player';
        ctx.fillStyle = 'rgba(8,10,16,0.6)';
        ctx.fillRect(0, 0, SCENE_W, SCENE_H);
        ctx.font = `700 84px ${FONT_FAMILY}`;
        ctx.fillStyle = won ? '#22c55e' : '#ef4444';
        ctx.fillText(won ? 'VICTORY' : 'DEFEAT', SCENE_W / 2, SCENE_H / 2 + 28);
      }
      ctx.textAlign = 'left';

      return canvas.toBuffer('image/png');
    },
  };
}

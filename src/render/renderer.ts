import { join } from 'node:path';
import { GlobalFonts, createCanvas } from '@napi-rs/canvas';
import { hasContinuous } from '../engine/abilities';
import { effectivePower, isAnchored } from '../engine/rules';
import { CELLS, LANES, LANE_NAMES, MAX_HP, opponentOf, type CardDef, type CardInstance, type GameState, type Seat } from '../engine/types';
import { ArtLibrary } from './art';
import {
  COMPACT,
  drawArena,
  drawCompactCard,
  drawEmptyCell,
  drawFullCard,
  drawHud,
  drawLaneHeader,
  type CompactFace,
} from './draw';
import { FrameLibrary } from './frames';
import { DEFAULT_LAYOUT, loadLayout, type CardLayout } from './layout';
import { CARD_FONT, FONT_FAMILY, PALETTE, TITLE_FONT } from './theme';

export interface CardView {
  def: CardDef;
  /** Frame tier, 1 to 5. */
  tier: number;
  /** Small label at the top of the card, e.g. "NEW" or "TIER 3". */
  badge?: string;
}

export interface BattleView {
  state: GameState;
  /** The seat drawn at the bottom of the board. */
  viewer: Seat;
  /** The hand card the player has picked, if any. */
  selectedUid?: number | null;
  /** Frame tier of each card the viewer owns, by card id. Anything else is drawn as tier 1. */
  tiers?: Record<string, number>;
}

export interface ImageRenderer {
  /** Full cards side by side in one row (single card, daily pack, collection page). `scale` 1 = 240 px per card. */
  cards(views: CardView[], options?: { scale?: number }): Promise<Buffer>;
  /** The lane battle: both players' HP, the 3x3 board and the viewer's hand. */
  battle(view: BattleView): Promise<Buffer>;
}

export interface RendererOptions {
  /** Folder with `fonts/`, `cards/` and `frames/`. */
  assetsDir: string;
}

const GAP = 14;
const FONT_FILES: [file: string, family: string][] = [
  ['Inter-Regular.woff2', FONT_FAMILY],
  ['Inter-Bold.woff2', FONT_FAMILY],
  ['Cinzel-Bold.woff2', TITLE_FONT],
  ['Aleo-Regular.woff2', CARD_FONT],
  ['Aleo-Bold.woff2', CARD_FONT],
];

// Battle scene geometry, in CSS pixels. The image is drawn at SCENE_SCALE times this for sharpness.
const SCENE_SCALE = 1.5;
const SCENE_W = 700;
const MARGIN = 40;
const LANE_W = COMPACT.w;
const LANE_GAP = 16;
const CELL_GAP = 8;
const HEADER_Y = 84;
const BOARD_Y = 108;
const BOARD_H = CELLS * COMPACT.h + (CELLS - 1) * CELL_GAP;
const HAND_SCALE = 0.74;
const HAND_COLS = 4;

/** Throws if the native canvas module or the bundled fonts cannot be loaded; callers fall back to text. */
export async function createImageRenderer({ assetsDir }: RendererOptions): Promise<ImageRenderer> {
  for (const [file, family] of FONT_FILES) {
    const path = join(assetsDir, 'fonts', file);
    if (!GlobalFonts.registerFromPath(path, family)) throw new Error(`Could not load font ${path}`);
  }

  let layout: CardLayout = DEFAULT_LAYOUT;
  try {
    layout = await loadLayout(join(assetsDir, 'frames', 'layout.json'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const art = new ArtLibrary(join(assetsDir, 'cards'));
  const frames = new FrameLibrary(join(assetsDir, 'frames'));

  const compactFace = (card: CardInstance, power: number, viewer: Seat, tiers: Record<string, number> | undefined, extra: Partial<CompactFace> = {}): CompactFace => ({
    id: card.def.id,
    name: card.def.name,
    cost: card.def.cost,
    power,
    basePower: card.def.power,
    tier: card.owner === viewer ? (tiers?.[card.def.id] ?? 1) : 1,
    hasAbility: card.def.ability !== undefined,
    ...extra,
  });

  return {
    async cards(views, { scale = 1.5 } = {}) {
      const cw = Math.round(layout.card.width * scale);
      const ch = Math.round(layout.card.height * scale);
      const canvas = createCanvas(views.length * cw + (views.length + 1) * GAP, ch + GAP * 2);
      const ctx = canvas.getContext('2d');
      for (const [i, view] of views.entries()) {
        ctx.save();
        ctx.translate(GAP + i * (cw + GAP), GAP);
        ctx.scale(cw / layout.card.width, ch / layout.card.height);
        drawFullCard(ctx, layout, view, await art.get(view.def.id), await frames.forTier(view.tier));
        ctx.restore();
      }
      return canvas.toBuffer('image/png');
    },

    async battle({ state, viewer, selectedUid = null, tiers }) {
      const me = state.players[viewer];
      const foeSeat = opponentOf(viewer);
      const foe = state.players[foeSeat];
      const hand = me.hand;
      const handRows = Math.ceil(hand.length / HAND_COLS);
      const handCardW = COMPACT.w * HAND_SCALE;
      const handCardH = COMPACT.h * HAND_SCALE;
      const boardBottom = BOARD_Y + BOARD_H;
      const myHudY = boardBottom + 12;
      const handY = myHudY + 92;
      const height = hand.length > 0 ? handY + handRows * handCardH + (handRows - 1) * CELL_GAP + 20 : myHudY + 76;

      const canvas = createCanvas(SCENE_W * SCENE_SCALE, Math.round(height * SCENE_SCALE));
      const ctx = canvas.getContext('2d');
      ctx.scale(SCENE_SCALE, SCENE_SCALE);
      drawArena(ctx, SCENE_W, height, BOARD_Y + BOARD_H / 2, state.round * 977 + 13);

      const yourTurn = state.active === viewer && !state.winner;
      const boardWidth = LANES * LANE_W + (LANES - 1) * LANE_GAP;

      ctx.save();
      ctx.translate(MARGIN, 14);
      drawHud(ctx, { label: 'THE ENEMY', color: PALETTE.theirs, hp: foe.hp, maxHp: MAX_HP, hand: foe.hand.length, deck: foe.deck.length }, boardWidth);
      ctx.restore();

      ctx.textAlign = 'center';
      ctx.font = `700 12px ${TITLE_FONT}`;
      ctx.fillStyle = PALETTE.gold;
      ctx.fillText(`ROUND ${state.round}${state.winner ? '' : yourTurn ? '  ·  YOUR TURN' : '  ·  ENEMY TURN'}`, SCENE_W / 2, 66);
      ctx.textAlign = 'left';

      for (let lane = 0; lane < LANES; lane++) {
        const x = MARGIN + lane * (LANE_W + LANE_GAP);
        const cells = state.lanes[lane];
        const tags: string[] = [];
        if (isAnchored(cells)) tags.push('ANCHORED');
        for (const seat of [viewer, foeSeat] as const) {
          if (cells.some((c) => c && c.owner === seat && hasContinuous(c.def, 'laneDouble'))) tags.push(seat === viewer ? 'YOU x2' : 'ENEMY x2');
        }
        ctx.save();
        ctx.translate(x, HEADER_Y);
        drawLaneHeader(ctx, LANE_NAMES[lane], tags, LANE_W);
        ctx.restore();

        for (let row = 0; row < CELLS; row++) {
          const card = cells[viewer === 'bottom' ? row : CELLS - 1 - row];
          ctx.save();
          ctx.translate(x, BOARD_Y + row * (COMPACT.h + CELL_GAP));
          if (card) {
            drawCompactCard(ctx, compactFace(card, effectivePower(state, lane, card), viewer, tiers, { owner: card.owner === viewer ? 'mine' : 'theirs' }), await art.get(card.def.id));
          } else {
            drawEmptyCell(ctx);
          }
          ctx.restore();
        }
      }

      ctx.save();
      ctx.translate(MARGIN, myHudY);
      drawHud(
        ctx,
        {
          label: 'YOU',
          color: PALETTE.mine,
          hp: me.hp,
          maxHp: MAX_HP,
          hand: hand.length,
          deck: me.deck.length,
          energy: { current: yourTurn ? me.energy : 0, max: Math.min(Math.max(me.turns, 1), 9) },
        },
        boardWidth,
      );
      ctx.restore();

      if (hand.length > 0) {
        ctx.font = `700 12px ${TITLE_FONT}`;
        ctx.fillStyle = PALETTE.muted;
        ctx.fillText('YOUR HAND', MARGIN, handY - 12);
        const xGap = (boardWidth - HAND_COLS * handCardW) / (HAND_COLS - 1);
        for (const [i, card] of hand.entries()) {
          ctx.save();
          ctx.translate(MARGIN + (i % HAND_COLS) * (handCardW + xGap), handY + Math.floor(i / HAND_COLS) * (handCardH + CELL_GAP));
          ctx.scale(HAND_SCALE, HAND_SCALE);
          drawCompactCard(
            ctx,
            compactFace(card, card.def.power, viewer, tiers, { index: i + 1, selected: card.uid === selectedUid, dim: yourTurn && card.def.cost > me.energy }),
            await art.get(card.def.id),
          );
          ctx.restore();
        }
      }

      if (state.winner) {
        const won = state.winner === viewer;
        const draw = state.winner === 'draw';
        ctx.fillStyle = 'rgba(4,3,6,0.66)';
        ctx.fillRect(0, BOARD_Y - 6, SCENE_W, BOARD_H + 12);
        ctx.textAlign = 'center';
        ctx.shadowColor = draw ? 'rgba(143,136,123,0.6)' : won ? 'rgba(201,151,58,0.7)' : 'rgba(155,29,46,0.8)';
        ctx.shadowBlur = 30;
        ctx.font = `700 70px ${TITLE_FONT}`;
        ctx.fillStyle = draw ? '#cfc7b6' : won ? '#e3bf6a' : '#b3243a';
        ctx.fillText(draw ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT', SCENE_W / 2, BOARD_Y + BOARD_H / 2 + 24);
        ctx.shadowBlur = 0;
        ctx.textAlign = 'left';
      }

      return canvas.toBuffer('image/png');
    },
  };
}

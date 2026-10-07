import { join } from "node:path";
import { GlobalFonts, createCanvas } from "@napi-rs/canvas";
import { hasContinuous } from "../engine/abilities";
import { effectivePower, isAnchored } from "../engine/rules";
import {
  CELLS,
  LANES,
  LANE_NAMES,
  MAX_HP,
  opponentOf,
  type CardDef,
  type CardInstance,
  type GameState,
  type Seat,
} from "../engine/types";
import type { MapView } from "../story/types";
import { ArtLibrary } from "./art";
import type { AvatarImage } from "./avatar";
import {
  COMPACT,
  drawArena,
  drawAvatar,
  drawCompactCard,
  drawEmptyCell,
  drawFullCard,
  drawHud,
  drawLaneHeader,
  drawMap,
  type CompactFace,
} from "./draw";
import { FrameLibrary } from "./frames";
import { DEFAULT_LAYOUT, loadLayout, type CardLayout } from "./layout";
import { CARD_FONT, FONT_FAMILY, PALETTE, TITLE_FONT } from "./theme";
import { DEFAULT_VARIANT, type VariantId } from "../data/variants";

export interface CardView {
  def: CardDef;
  /** The colour variant to draw. */
  variant: VariantId;
  /** Small label at the top of the card, e.g. "NEW" or "Blue". */
  badge?: string;
}

export interface BattleView {
  state: GameState;
  /** The seat drawn at the bottom of the board. */
  viewer: Seat;
  /** The hand card the player has picked, if any. */
  selectedUid?: number | null;
  /** Active variant of each card the viewer owns, by card id. Anything else is drawn as metal. */
  variants?: Record<string, VariantId>;
  /** The viewer's avatar, already decoded. Null/omitted -> generated placeholder. */
  playerAvatar?: AvatarImage | null;
  /** The opponent's portrait, already decoded. Null/omitted -> generated placeholder. */
  opponentAvatar?: AvatarImage | null;
  /** Raw player HUD name (e.g. "Ocean Eyes"). drawHud uppercases it; falls back to "You" when absent. */
  playerName?: string;
  /** Raw opponent HUD name. drawHud uppercases it; falls back to "The Enemy" when absent. */
  opponentName?: string;
}

export interface ImageRenderer {
  /** Full cards side by side in one row (single card, daily pack, collection page). `scale` 1 = 240 px per card. */
  cards(views: CardView[], options?: { scale?: number }): Promise<Buffer>;
  /** The lane battle: both players' HP, the 3x3 board and the viewer's hand. */
  battle(view: BattleView): Promise<Buffer>;
  /** A story map: places and the paths between them. */
  map(map: MapView): Promise<Buffer>;
  /** The cards shown in the story's book, as a grid with bargain and eternal cards marked. */
  pack(cards: CardDef[]): Promise<Buffer>;
}

export interface RendererOptions {
  /** Folder with `fonts/`, `cards/` and `frames/`. */
  assetsDir: string;
}

const GAP = 14;
const FONT_FILES: [file: string, family: string][] = [
  ["Alegreya-Variable.ttf", FONT_FAMILY],
  ["Cinzel-Bold.woff2", TITLE_FONT],
  ["Aleo-Regular.woff2", CARD_FONT],
  ["Aleo-Bold.woff2", CARD_FONT],
];

// Battle scene geometry, in CSS pixels. The image is drawn at a scale times this for sharpness.
const SCENE_SCALE = 1.5;
// The battle image is drawn at SCENE_SCALE; full cards in the hand replace the need for extra supersampling.
const BATTLE_SCALE = SCENE_SCALE;
/** Caps a raw HUD name so a long one cannot overflow the single-line HUD label. */
const hudName = (s: string): string =>
  s.length > 22 ? s.slice(0, 21) + "…" : s;
const SCENE_W = 700;
const MARGIN = 40;
const LANE_W = COMPACT.w;
const LANE_GAP = 16;
const CELL_GAP = 8;
const HEADER_Y = 84;
const BOARD_Y = 108;
const BOARD_H = CELLS * COMPACT.h + (CELLS - 1) * CELL_GAP;
// The hand shows full portrait cards, scaled down from the full 240x336 size.
const HAND_CARD_SCALE = 0.45;
const HAND_COLS = 5;
// Battle HUD avatars: a circle at the left of each HUD strip. Tune layout here in one place.
const AVATAR_SIZE = 44;
const AVATAR_GAP = 12;

/** Throws if the native canvas module or the bundled fonts cannot be loaded; callers fall back to text. */
export async function createImageRenderer({
  assetsDir,
}: RendererOptions): Promise<ImageRenderer> {
  for (const [file, family] of FONT_FILES) {
    const path = join(assetsDir, "fonts", file);
    if (!GlobalFonts.registerFromPath(path, family))
      throw new Error(`Could not load font ${path}`);
  }

  let layout: CardLayout = DEFAULT_LAYOUT;
  try {
    layout = await loadLayout(join(assetsDir, "frames", "layout.json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const art = new ArtLibrary(join(assetsDir, "cards"));
  const frames = new FrameLibrary(join(assetsDir, "frames"));

  const compactFace = (
    card: CardInstance,
    power: number,
    viewer: Seat,
    variants: Record<string, VariantId> | undefined,
    extra: Partial<CompactFace> = {},
  ): CompactFace => ({
    id: card.def.id,
    name: card.def.name,
    cost: card.def.cost,
    power,
    basePower: card.def.power,
    variant:
      card.owner === viewer
        ? (variants?.[card.def.id] ?? DEFAULT_VARIANT)
        : DEFAULT_VARIANT,
    hasAbility: card.def.ability !== undefined,
    ...extra,
  });

  return {
    async cards(views, { scale = 1.5 } = {}) {
      const cw = Math.round(layout.card.width * scale);
      const ch = Math.round(layout.card.height * scale);
      const canvas = createCanvas(
        views.length * cw + (views.length + 1) * GAP,
        ch + GAP * 2,
      );
      const ctx = canvas.getContext("2d");
      for (const [i, view] of views.entries()) {
        ctx.save();
        ctx.translate(GAP + i * (cw + GAP), GAP);
        ctx.scale(cw / layout.card.width, ch / layout.card.height);
        drawFullCard(
          ctx,
          layout,
          view,
          await art.get(view.def.id),
          await frames.forVariant(view.variant),
        );
        ctx.restore();
      }
      return canvas.toBuffer("image/png");
    },

    async battle({
      state,
      viewer,
      selectedUid = null,
      variants,
      playerAvatar = null,
      opponentAvatar = null,
      playerName,
      opponentName,
    }) {
      const me = state.players[viewer];
      const foeSeat = opponentOf(viewer);
      const foe = state.players[foeSeat];
      const hand = me.hand;
      const handRows = Math.ceil(hand.length / HAND_COLS);
      const handCardW = Math.round(layout.card.width * HAND_CARD_SCALE);
      const handCardH = Math.round(layout.card.height * HAND_CARD_SCALE);
      const boardBottom = BOARD_Y + BOARD_H;
      const myHudY = boardBottom + 12;
      const handY = myHudY + 62;
      const height =
        hand.length > 0
          ? handY + handRows * handCardH + (handRows - 1) * CELL_GAP + 20
          : myHudY + 76;

      const canvas = createCanvas(
        SCENE_W * BATTLE_SCALE,
        Math.round(height * BATTLE_SCALE),
      );
      const ctx = canvas.getContext("2d");
      ctx.scale(BATTLE_SCALE, BATTLE_SCALE);
      drawArena(
        ctx,
        SCENE_W,
        height,
        BOARD_Y + BOARD_H / 2,
        state.round * 977 + 13,
      );

      const yourTurn = state.active === viewer && !state.winner;
      const boardWidth = LANES * LANE_W + (LANES - 1) * LANE_GAP;
      // The HUD text block shifts right to make room for the avatar in the left margin gutter.
      const hudShift = AVATAR_SIZE + AVATAR_GAP;
      const hudWidth = boardWidth - hudShift;

      drawAvatar(
        ctx,
        MARGIN + AVATAR_SIZE / 2,
        14 + AVATAR_SIZE / 2,
        AVATAR_SIZE,
        opponentAvatar,
        PALETTE.theirs,
      );
      ctx.save();
      ctx.translate(MARGIN + hudShift, 14);
      drawHud(
        ctx,
        {
          label: hudName(opponentName ?? "The Enemy"),
          color: PALETTE.theirs,
          hp: foe.hp,
          maxHp: MAX_HP,
          hand: foe.hand.length,
          deck: foe.deck.length,
        },
        hudWidth,
      );
      ctx.restore();

      ctx.textAlign = "center";
      ctx.font = `700 12px ${TITLE_FONT}`;
      ctx.fillStyle = PALETTE.gold;
      ctx.fillText(
        `ROUND ${state.round}${state.winner ? "" : yourTurn ? "  ·  YOUR TURN" : "  ·  ENEMY TURN"}`,
        SCENE_W / 2,
        66,
      );
      ctx.textAlign = "left";

      for (let lane = 0; lane < LANES; lane++) {
        const x = MARGIN + lane * (LANE_W + LANE_GAP);
        const cells = state.lanes[lane];
        const tags: string[] = [];
        if (isAnchored(cells)) tags.push("ANCHORED");
        for (const seat of [viewer, foeSeat] as const) {
          if (
            cells.some(
              (c) =>
                c && c.owner === seat && hasContinuous(c.def, "laneDouble"),
            )
          )
            tags.push(seat === viewer ? "YOU x2" : "ENEMY x2");
        }
        ctx.save();
        ctx.translate(x, HEADER_Y);
        drawLaneHeader(ctx, LANE_NAMES[lane], tags, LANE_W);
        ctx.restore();

        for (let row = 0; row < CELLS; row++) {
          const card = cells[viewer === "bottom" ? row : CELLS - 1 - row];
          ctx.save();
          ctx.translate(x, BOARD_Y + row * (COMPACT.h + CELL_GAP));
          if (card) {
            drawCompactCard(
              ctx,
              compactFace(
                card,
                effectivePower(state, lane, card),
                viewer,
                variants,
                { owner: card.owner === viewer ? "mine" : "theirs" },
              ),
              await art.get(card.def.id),
            );
          } else {
            drawEmptyCell(ctx);
          }
          ctx.restore();
        }
      }

      drawAvatar(
        ctx,
        MARGIN + AVATAR_SIZE / 2,
        myHudY + AVATAR_SIZE / 2,
        AVATAR_SIZE,
        playerAvatar,
        PALETTE.mine,
      );
      ctx.save();
      ctx.translate(MARGIN + hudShift, myHudY);
      drawHud(
        ctx,
        {
          label: hudName(playerName ?? "You"),
          color: PALETTE.mine,
          hp: me.hp,
          maxHp: MAX_HP,
          hand: hand.length,
          deck: me.deck.length,
          energy: {
            current: yourTurn ? me.energy : 0,
            max: Math.min(Math.max(me.turns, 1), 9),
          },
        },
        hudWidth,
      );
      ctx.restore();

      if (hand.length > 0) {
        ctx.font = `700 12px ${TITLE_FONT}`;
        ctx.fillStyle = PALETTE.muted;
        ctx.fillText("YOUR HAND", MARGIN, handY - 12);
        const xGap = (boardWidth - HAND_COLS * handCardW) / (HAND_COLS - 1);
        for (const [i, card] of hand.entries()) {
          const cx = MARGIN + (i % HAND_COLS) * (handCardW + xGap);
          const cy = handY + Math.floor(i / HAND_COLS) * (handCardH + CELL_GAP);
          const isSelected = card.uid === selectedUid;
          const isDim = yourTurn && card.def.cost > me.energy;
          const variant =
            card.owner === viewer
              ? (variants?.[card.def.id] ?? DEFAULT_VARIANT)
              : DEFAULT_VARIANT;

          ctx.save();
          ctx.translate(cx, cy);
          ctx.scale(HAND_CARD_SCALE, HAND_CARD_SCALE);
          if (isDim) ctx.globalAlpha = 0.4;
          drawFullCard(
            ctx,
            layout,
            { def: card.def, variant },
            await art.get(card.def.id),
            await frames.forVariant(variant),
          );
          ctx.restore();

          if (isSelected) {
            const r =
              Math.round(layout.card.cornerRadius * HAND_CARD_SCALE) + 1;
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(cx - 1, cy - 1, handCardW + 2, handCardH + 2, r);
            ctx.lineWidth = 3.5;
            ctx.strokeStyle = PALETTE.gold;
            ctx.shadowColor = PALETTE.gold;
            ctx.shadowBlur = 14;
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.restore();
          }
        }
      }

      if (state.winner) {
        const won = state.winner === viewer;
        const draw = state.winner === "draw";
        ctx.fillStyle = "rgba(4,3,6,0.66)";
        ctx.fillRect(0, BOARD_Y - 6, SCENE_W, BOARD_H + 12);
        ctx.textAlign = "center";
        ctx.shadowColor = draw
          ? "rgba(143,136,123,0.6)"
          : won
            ? "rgba(201,151,58,0.7)"
            : "rgba(155,29,46,0.8)";
        ctx.shadowBlur = 30;
        ctx.font = `700 70px ${TITLE_FONT}`;
        ctx.fillStyle = draw ? "#cfc7b6" : won ? "#e3bf6a" : "#b3243a";
        ctx.fillText(
          draw ? "DRAW" : won ? "VICTORY" : "DEFEAT",
          SCENE_W / 2,
          BOARD_Y + BOARD_H / 2 + 24,
        );
        ctx.shadowBlur = 0;
        ctx.textAlign = "left";
      }

      return canvas.toBuffer("image/png");
    },

    async map(view) {
      const w = 700;
      const h = 300;
      const canvas = createCanvas(w * SCENE_SCALE, h * SCENE_SCALE);
      const ctx = canvas.getContext("2d");
      ctx.scale(SCENE_SCALE, SCENE_SCALE);
      drawArena(ctx, w, h, h / 2, view.locations.length * 131 + 7);
      drawMap(ctx, w, h, view);
      return canvas.toBuffer("image/png");
    },

    async pack(cards) {
      const cols = 4;
      const rows = Math.ceil(cards.length / cols);
      const gap = 14;
      const side = 40;
      const top = 62;
      const w = side * 2 + cols * COMPACT.w + (cols - 1) * gap;
      const h = top + rows * COMPACT.h + (rows - 1) * gap + 28;
      const scale = 1.2;
      const canvas = createCanvas(Math.round(w * scale), Math.round(h * scale));
      const ctx = canvas.getContext("2d");
      ctx.scale(scale, scale);
      drawArena(ctx, w, h, h / 2, cards.length * 71 + 3);

      const count = (rarity: "eternal" | "bargain" | "common") =>
        cards.filter((c) => c.rarity === rarity).length;
      ctx.textAlign = "center";
      ctx.font = `700 22px ${TITLE_FONT}`;
      ctx.fillStyle = PALETTE.gold;
      ctx.fillText("THE BOOK OPENS", w / 2, 32);
      ctx.font = `700 12px ${FONT_FAMILY}`;
      ctx.fillStyle = PALETTE.muted;
      ctx.fillText(
        `${count("eternal")} ETERNAL  ·  ${count("bargain")} BARGAIN  ·  ${count("common")} COMMON`,
        w / 2,
        50,
      );
      ctx.textAlign = "left";

      for (const [i, card] of cards.entries()) {
        ctx.save();
        ctx.translate(
          side + (i % cols) * (COMPACT.w + gap),
          top + Math.floor(i / cols) * (COMPACT.h + gap),
        );
        drawCompactCard(
          ctx,
          {
            id: card.id,
            name: card.name,
            cost: card.cost,
            power: card.power,
            basePower: card.power,
            variant: DEFAULT_VARIANT,
            hasAbility: card.ability !== undefined,
            rarity: card.rarity,
          },
          await art.get(card.id),
        );
        ctx.restore();
      }
      return canvas.toBuffer("image/png");
    },
  };
}

import { join } from "node:path";
import { GlobalFonts, createCanvas } from "@napi-rs/canvas";
import { cardFaction, hasContinuous } from "../engine/abilities";
import { effectivePower, isAnchored } from "../engine/rules";
import {
  CELLS,
  LANES,
  LANE_NAMES,
  MAX_ENERGY,
  MAX_TURNS,
  opponentOf,
  type CardDef,
  type Faction,
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
  drawLaneHeader,
  drawMap,
  drawTideMeter,
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
  /** Raw player HUD name (e.g. "Ocean Eyes"). Uppercased for the identity row; "You" when absent. */
  playerName?: string;
  /** Raw opponent HUD name. Uppercased for the identity row; "The Enemy" when absent. */
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
  ["Aleo-Regular.ttf", CARD_FONT],
  ["Aleo-Bold.ttf", CARD_FONT],
];

// Battle scene geometry, in CSS pixels. The image is drawn at a scale times this for sharpness.
const SCENE_SCALE = 1.5;
// The battle image is drawn at SCENE_SCALE; full cards in the hand replace the need for extra supersampling.
const BATTLE_SCALE = SCENE_SCALE;
/** Caps a raw HUD name so a long one cannot overflow the narrow left-rail HUD label. */
const hudName = (s: string): string =>
  s.length > 12 ? s.slice(0, 11) + "…" : s;

/**
 * A two-line identity block (name in the side colour, HAND·DECK below in muted) drawn to the right
 * of an avatar and vertically centered on the avatar's center. Imports: uses the module's fonts.
 */
function drawIdentityText(
  ctx: import("@napi-rs/canvas").SKRSContext2D,
  x: number,
  centerY: number,
  name: string,
  color: string,
  sub: string,
): void {
  const nameSize = 15;
  const subSize = 12;
  const lineGap = 6;
  const total = nameSize + lineGap + subSize;
  const top = centerY - total / 2;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `700 ${nameSize}px ${TITLE_FONT}`;
  ctx.fillStyle = color;
  ctx.fillText(name.toUpperCase(), x, top);
  ctx.font = `400 ${subSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = PALETTE.muted;
  ctx.fillText(sub, x, top + nameSize + lineGap);
  ctx.textBaseline = "alphabetic";
}
// The battle image is a fixed 1:1 square: SCENE logical px, scaled by BATTLE_SCALE to the device size.
const SCENE = 845;
const MARGIN = 24;
// Left rail (enemy identity / meter / player identity) and right gutter (TURN + energy pips).
const RAIL_W = 150;
const GUTTER_W = 70;
const CELL_GAP = 12;
// The single hand row at the bottom of the scene.
const HAND_GAP = 10;
const HAND_MARGIN = 16;
const TOP_PAD = 24;
const BOTTOM_PAD = 24;
// Lane header strip above the board.
const LANE_HEADER_H = 18;
const LANE_HEADER_GAP = 6;
// Battle HUD avatars: a circle at the top of each identity block in the left rail.
const AVATAR_SIZE = 44;
const AVATAR_GAP = 12;
// The vertical Eye Privilege meter lives in the left rail between the two identities.
const METER_W = 14;
// Board cells are full portrait cards at this scale; the hand uses smaller full cards.
const BOARD_CARD_SCALE = 0.58;
const HAND_CARD_SCALE = 0.27;
// Energy orbs in the right gutter: a single row of MAX_ENERGY small circles.
const PIP_R = 5;
const PIP_GAP = 4;
const PIP_COLS = MAX_ENERGY;

/**
 * The right-gutter energy readout: an "ENERGY" label then a single row of MAX_ENERGY orbs,
 * right-anchored to `right`. The first `shown` orbs are lit (bright + glow), the rest are dim. `labelY`
 * is the label's top; the row starts just below it. Restores textAlign/textBaseline when done.
 */
function drawEnergyPips(
  ctx: import("@napi-rs/canvas").SKRSContext2D,
  right: number,
  labelY: number,
  shown: number,
): void {
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.font = `700 12px ${TITLE_FONT}`;
  ctx.fillStyle = PALETTE.energy;
  ctx.fillText("ENERGY", right, labelY);

  const pipStride = 2 * PIP_R + PIP_GAP;
  const gridW = PIP_COLS * pipStride - PIP_GAP;
  const gridLeft = right - gridW;
  const gridTop = labelY + 16;
  for (let i = 0; i < MAX_ENERGY; i++) {
    const col = i % PIP_COLS;
    const row = Math.floor(i / PIP_COLS);
    const cx = gridLeft + col * pipStride + PIP_R;
    const cy = gridTop + row * pipStride + PIP_R;
    const lit = i < shown;
    ctx.beginPath();
    ctx.arc(cx, cy, PIP_R, 0, Math.PI * 2);
    if (lit) {
      ctx.fillStyle = PALETTE.energy;
      ctx.shadowColor = PALETTE.energy;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = "rgba(91,176,232,0.18)";
      ctx.fill();
    }
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** Throws if the native canvas module or the bundled fonts cannot be loaded; callers fall back to text. */
export async function createImageRenderer({
  assetsDir,
}: RendererOptions): Promise<ImageRenderer> {
  for (const [file, family] of FONT_FILES) {
    const path = join(assetsDir, "fonts", file);
    if (!GlobalFonts.registerFromPath(path, family))
      throw new Error(`Could not load font ${path}`);
  }

  const loadLayoutOrDefault = async (
    path: string,
    fallback: CardLayout,
  ): Promise<CardLayout> => {
    try {
      return await loadLayout(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return fallback;
    }
  };

  const eyesLayout = await loadLayoutOrDefault(
    join(assetsDir, "frames", "layout.json"),
    DEFAULT_LAYOUT,
  );
  const botuoiLayout = await loadLayoutOrDefault(
    join(assetsDir, "frames", "botuoi", "layout.json"),
    eyesLayout,
  );
  const layoutFor = (faction: Faction): CardLayout =>
    faction === "botuoi" ? botuoiLayout : eyesLayout;

  const art = new ArtLibrary(join(assetsDir, "cards"));
  const frames = new FrameLibrary(join(assetsDir, "frames"));

  return {
    async cards(views, { scale = 1.5 } = {}) {
      // Every card shares the same output cell size, computed from The Eyes layout so a row of mixed
      // factions still lines up; each card is then scaled from its own layout's base card size.
      const cw = Math.round(eyesLayout.card.width * scale);
      const ch = Math.round(eyesLayout.card.height * scale);
      const canvas = createCanvas(
        views.length * cw + (views.length + 1) * GAP,
        ch + GAP * 2,
      );
      const ctx = canvas.getContext("2d");
      for (const [i, view] of views.entries()) {
        const faction = cardFaction(view.def);
        const layout = layoutFor(faction);
        ctx.save();
        ctx.translate(GAP + i * (cw + GAP), GAP);
        ctx.scale(cw / layout.card.width, ch / layout.card.height);
        drawFullCard(
          ctx,
          layout,
          view,
          await art.get(view.def.id),
          await frames.forCard(faction, view.variant),
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

      // Board cells and hand cards are full portrait cards scaled from The Eyes base size (botuoi
      // shares the same 240x336 base), so the whole square is driven by eyesLayout.card.
      const w = eyesLayout.card.width;
      const h = eyesLayout.card.height;
      const cellW = Math.round(w * BOARD_CARD_SCALE);
      const cellH = Math.round(h * BOARD_CARD_SCALE);
      const BOARD_W = LANES * cellW + (LANES - 1) * CELL_GAP;
      const BOARD_H = CELLS * cellH + (CELLS - 1) * CELL_GAP;
      const handCardW = Math.round(w * HAND_CARD_SCALE);
      const handCardH = Math.round(h * HAND_CARD_SCALE);

      // Vertical layout: the lane-header + board block is centred in the space above the bottom hand band.
      const HAND_BAND_H = handCardH + HAND_MARGIN;
      const BOARD_BLOCK_H = LANE_HEADER_H + LANE_HEADER_GAP + BOARD_H;
      const availableAbove = SCENE - HAND_BAND_H;
      const blockTop = Math.round((availableAbove - BOARD_BLOCK_H) / 2);
      const LANE_HEADER_Y = Math.max(TOP_PAD, blockTop);
      const BOARD_Y = LANE_HEADER_Y + LANE_HEADER_H + LANE_HEADER_GAP;

      // Horizontal layout: left rail, centred board channel, right gutter.
      const railRight = MARGIN + RAIL_W;
      const gutterLeft = SCENE - MARGIN - GUTTER_W;
      const channelW = gutterLeft - railRight;
      const BOARD_X = railRight + Math.round((channelW - BOARD_W) / 2);
      const handY = SCENE - BOTTOM_PAD - handCardH;

      const device = Math.round(SCENE * BATTLE_SCALE);
      const canvas = createCanvas(device, device);
      const ctx = canvas.getContext("2d");
      ctx.scale(BATTLE_SCALE, BATTLE_SCALE);
      drawArena(
        ctx,
        SCENE,
        SCENE,
        BOARD_Y + BOARD_H / 2,
        state.round * 977 + 13,
      );

      const yourTurn = state.active === viewer && !state.winner;

      // --- Left rail: enemy identity (top), Eye Privilege meter (middle), player identity (bottom). ---
      const RAIL_X = MARGIN;
      const enemyCenterY = LANE_HEADER_Y + AVATAR_SIZE / 2;
      drawAvatar(
        ctx,
        RAIL_X + AVATAR_SIZE / 2,
        enemyCenterY,
        AVATAR_SIZE,
        opponentAvatar,
        PALETTE.theirs,
      );
      drawIdentityText(
        ctx,
        RAIL_X + AVATAR_SIZE + AVATAR_GAP,
        enemyCenterY,
        hudName(opponentName ?? "The Enemy"),
        PALETTE.theirs,
        `HAND ${foe.hand.length} · DECK ${foe.deck.length}`,
      );

      const boardBottom = BOARD_Y + BOARD_H;
      const playerCenterY = boardBottom - AVATAR_SIZE / 2;
      drawAvatar(
        ctx,
        RAIL_X + AVATAR_SIZE / 2,
        playerCenterY,
        AVATAR_SIZE,
        playerAvatar,
        PALETTE.mine,
      );
      drawIdentityText(
        ctx,
        RAIL_X + AVATAR_SIZE + AVATAR_GAP,
        playerCenterY,
        hudName(playerName ?? "You"),
        PALETTE.mine,
        `HAND ${hand.length} · DECK ${me.deck.length}`,
      );

      // The Eye Privilege meter runs between the two avatars. No numeric value on the bar. Drawn
      // before the win overlay so the overlay scrim dims it too.
      const meterX = RAIL_X + AVATAR_SIZE / 2 - METER_W / 2;
      const meterTop = enemyCenterY + AVATAR_SIZE / 2 + 12;
      const meterBottom = playerCenterY - AVATAR_SIZE / 2 - 12;
      drawTideMeter(
        ctx,
        meterX,
        meterTop,
        METER_W,
        meterBottom - meterTop,
        state.balance,
      );

      // --- Right gutter: TURN counter (top) + energy pips (below). ---
      const turnNo = Math.min(
        state.turnsPlayed + (state.winner ? 0 : 1),
        MAX_TURNS,
      );
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.font = `700 14px ${TITLE_FONT}`;
      ctx.fillStyle = PALETTE.gold;
      ctx.fillText(
        `TURN ${turnNo} / ${MAX_TURNS}`,
        SCENE - MARGIN,
        LANE_HEADER_Y + 12,
      );
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      drawEnergyPips(
        ctx,
        SCENE - MARGIN,
        LANE_HEADER_Y + 34,
        yourTurn ? me.energy : 0,
      );

      // --- Board: 3x3 full portrait cards with owner outlines + live-power colouring. ---
      for (let lane = 0; lane < LANES; lane++) {
        const x = BOARD_X + lane * (cellW + CELL_GAP);
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
        ctx.translate(x, LANE_HEADER_Y);
        // Lane names (LEFT/MIDDLE/RIGHT) are dropped; keep the header only for status tags
        // (ANCHORED, YOU x2, ENEMY x2) so lane modifiers stay visible.
        drawLaneHeader(ctx, "", tags, cellW);
        ctx.restore();

        for (let row = 0; row < CELLS; row++) {
          const card = cells[viewer === "bottom" ? row : CELLS - 1 - row];
          ctx.save();
          ctx.translate(x, BOARD_Y + row * (cellH + CELL_GAP));
          if (card) {
            const faction = cardFaction(card.def);
            const variant =
              card.owner === viewer
                ? (variants?.[card.def.id] ?? DEFAULT_VARIANT)
                : DEFAULT_VARIANT;
            const r = Math.round(
              eyesLayout.card.cornerRadius * BOARD_CARD_SCALE,
            );
            ctx.save();
            ctx.scale(BOARD_CARD_SCALE, BOARD_CARD_SCALE);
            drawFullCard(
              ctx,
              layoutFor(faction),
              {
                def: card.def,
                variant,
                livePower: effectivePower(state, lane, card),
              },
              await art.get(card.def.id),
              await frames.forCard(faction, variant),
            );
            ctx.restore();
            // Owner-coloured outline around the whole card.
            const ownerColor =
              card.owner === viewer ? PALETTE.mine : PALETTE.theirs;
            ctx.beginPath();
            ctx.roundRect(-1, -1, cellW + 2, cellH + 2, r + 1);
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = ownerColor;
            ctx.shadowColor = ownerColor;
            ctx.shadowBlur = 8;
            ctx.stroke();
            ctx.shadowBlur = 0;
          } else {
            drawEmptyCell(ctx, cellW, cellH);
          }
          ctx.restore();
        }
      }

      // Win overlay (after the board + meter so the scrim dims them too).
      if (state.winner) {
        const won = state.winner === viewer;
        const draw = state.winner === "draw";
        ctx.fillStyle = "rgba(4,3,6,0.66)";
        ctx.fillRect(0, BOARD_Y - 6, SCENE, BOARD_H + 12);
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
          SCENE / 2,
          BOARD_Y + BOARD_H / 2 + 24,
        );
        ctx.shadowBlur = 0;
        ctx.textAlign = "left";
      }

      // --- Hand: a single bottom row of smaller full cards, confined to the board column. ---
      if (hand.length > 0) {
        const handCount = hand.length;
        const handRowW = handCount * handCardW + (handCount - 1) * HAND_GAP;
        const handX0 = BOARD_X + Math.round((BOARD_W - handRowW) / 2);
        for (const [i, card] of hand.entries()) {
          const cx = handX0 + i * (handCardW + HAND_GAP);
          const cy = handY;
          const isSelected = card.uid === selectedUid;
          const isDim = yourTurn && card.def.cost > me.energy;
          const variant =
            card.owner === viewer
              ? (variants?.[card.def.id] ?? DEFAULT_VARIANT)
              : DEFAULT_VARIANT;
          const faction = cardFaction(card.def);
          const cardLayout = layoutFor(faction);

          ctx.save();
          ctx.translate(cx, cy);
          ctx.scale(HAND_CARD_SCALE, HAND_CARD_SCALE);
          if (isDim) ctx.globalAlpha = 0.4;
          drawFullCard(
            ctx,
            cardLayout,
            { def: card.def, variant },
            await art.get(card.def.id),
            await frames.forCard(faction, variant),
          );
          ctx.restore();

          if (isSelected) {
            const r =
              Math.round(eyesLayout.card.cornerRadius * HAND_CARD_SCALE) + 1;
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

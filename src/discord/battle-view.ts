import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import { cardText } from "../engine/abilities";
import { pushInto } from "../engine/push";
import { canPlay } from "../engine/rules";
import {
  CELLS,
  LANE_NAMES,
  MAX_TURNS,
  opponentOf,
  type GameState,
  type LaneIndex,
  type Seat,
} from "../engine/types";
import { EMBED_COLOR } from "../render/theme";
import { attach } from "./images";

export interface BattleScreen {
  id: string;
  state: GameState;
  /** The seat the person looking at this message plays. */
  viewer: Seat;
  /** The card picked in the select menu, if any. */
  selectedUid: number | null;
  /** What just happened, already worded for the viewer. */
  log: string[];
  /** The board image. When absent the board is described in text. */
  image?: Buffer;
  /** Shown as the player's HUD label; the renderer falls back to "You" when absent. */
  playerName?: string;
  /** Shown as the opponent's HUD label; the renderer falls back to "The Enemy" when absent. */
  opponentName?: string;
  /** Whether the Reset turn button is enabled (human has acted this turn, game not over). */
  canReset?: boolean;
}

const LANES = [0, 1, 2] as const;

/** A text drawing of the board, for when images are unavailable. Your cards are marked ▲, the enemy's ▼. */
function boardText(state: GameState, viewer: Seat): string {
  const rows: string[] = [];
  for (let row = 0; row < CELLS; row++) {
    const cells = LANES.map((lane) => {
      const card =
        state.lanes[lane][viewer === "bottom" ? row : CELLS - 1 - row];
      return (
        card
          ? `${card.owner === viewer ? "▲" : "▼"} ${card.def.name.slice(0, 11)} ${Math.max(0, card.def.power + card.bonus)}`
          : "·"
      ).padEnd(16);
    });
    rows.push(cells.join("│"));
  }
  return [
    "LEFT".padEnd(16) + "│" + "MIDDLE".padEnd(16) + "│" + "RIGHT",
    ...rows,
  ].join("\n");
}

function select(
  screen: BattleScreen,
  myTurn: boolean,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const me = screen.state.players[screen.viewer];
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`battle:${screen.id}:pick`)
    .setPlaceholder("Pick a card to play");
  if (me.hand.length === 0) {
    menu
      .addOptions({ label: "No cards in your hand", value: "none" })
      .setDisabled(true);
  } else {
    menu.addOptions(
      me.hand.slice(0, 25).map((card, i) => {
        const text = cardText(card.def) || "No ability";
        return {
          label:
            `${i + 1}. ${card.def.name} · cost ${card.def.cost}, power ${card.def.power}`.slice(
              0,
              100,
            ),
          description:
            `${card.def.cost > me.energy ? "Too expensive. " : ""}${text}`.slice(
              0,
              100,
            ),
          value: String(card.uid),
          default: card.uid === screen.selectedUid,
        };
      }),
    );
    menu.setDisabled(!myTurn);
  }
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function laneButtons(
  screen: BattleScreen,
  myTurn: boolean,
): ActionRowBuilder<ButtonBuilder> {
  const { state, viewer } = screen;
  const card = state.players[viewer].hand.find(
    (c) => c.uid === screen.selectedUid,
  );
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const lane of LANES) {
    const button = new ButtonBuilder()
      .setCustomId(`battle:${screen.id}:lane:${lane}`)
      .setLabel(LANE_NAMES[lane])
      .setStyle(ButtonStyle.Secondary);
    const playable =
      myTurn &&
      card !== undefined &&
      canPlay(state, card.uid, lane as LaneIndex).ok;
    button.setDisabled(!playable);
    if (playable && card) {
      // Show what the push would do before the player commits.
      const { destroyed } = pushInto(state.lanes[lane], card, viewer);
      if (destroyed) {
        button
          .setStyle(
            destroyed.owner === viewer
              ? ButtonStyle.Danger
              : ButtonStyle.Success,
          )
          .setEmoji(destroyed.owner === viewer ? "⚠️" : "💥");
      } else {
        button.setStyle(ButtonStyle.Primary);
      }
    }
    row.addComponents(button);
  }
  return row;
}

function actionButtons(
  screen: BattleScreen,
  myTurn: boolean,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`battle:${screen.id}:end`)
      .setLabel("End turn")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!myTurn),
    new ButtonBuilder()
      .setCustomId(`battle:${screen.id}:reset`)
      .setLabel("Reset turn")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!(screen.canReset ?? false)),
    new ButtonBuilder()
      .setCustomId(`battle:${screen.id}:forfeit`)
      .setLabel("Forfeit")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!myTurn),
  );
}

/** Just the three component rows, for updates that must not touch the image (picking a card). */
export function battleComponents(screen: BattleScreen) {
  const myTurn =
    screen.state.winner === null && screen.state.active === screen.viewer;
  return [
    select(screen, myTurn),
    laneButtons(screen, myTurn),
    actionButtons(screen, myTurn),
  ];
}

function infoLine(state: GameState, viewer: Seat): string {
  const me = state.players[viewer];
  const foe = state.players[opponentOf(viewer)];
  // Same rule as the renderer TURN counter (Part 4.5): in-progress turn while playing,
  // turns-actually-resolved once over, both clamped to MAX_TURNS.
  const turn = Math.min(state.turnsPlayed + (state.winner ? 0 : 1), MAX_TURNS);
  return `Tide ${state.balance}-${100 - state.balance} · Turn ${turn}/${MAX_TURNS} · You H${me.hand.length} D${me.deck.length} · Enemy H${foe.hand.length} D${foe.deck.length} · E${me.energy}`;
}

function embed(
  screen: BattleScreen,
  title: string,
  color: number,
  lead?: string,
): EmbedBuilder {
  const { state, viewer } = screen;
  const log = screen.log.join("\n") || "Pick a card, then press a lane.";
  const text = (lead ? `${lead}\n\n` : "") + log;
  const e = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(text.slice(0, 3000))
    .setFooter({ text: infoLine(state, viewer) });
  if (!screen.image) {
    e.addFields(
      {
        name: "Board",
        value: `\`\`\`\n${boardText(state, viewer)}\n\`\`\``,
      },
      {
        name: "Your hand",
        value:
          state.players[viewer].hand
            .map(
              (c, i) =>
                `${i + 1}. **${c.def.name}** (cost ${c.def.cost}, power ${c.def.power})`,
            )
            .join("\n")
            .slice(0, 1000) || "Empty",
      },
    );
  }
  return e;
}

export function renderBattle(screen: BattleScreen) {
  const { state } = screen;
  const myTurn = state.winner === null && state.active === screen.viewer;
  const turn = Math.min(state.turnsPlayed + (state.winner ? 0 : 1), MAX_TURNS);
  return {
    content: "",
    embeds: [
      embed(
        screen,
        `⚔️ Turn ${turn}/${MAX_TURNS} · ${myTurn ? "Your turn" : "Enemy's turn"}`,
        EMBED_COLOR.battle,
      ),
    ],
    components: battleComponents(screen),
    files: screen.image
      ? [
          attach(
            screen.image,
            `battle-${screen.id}-r${state.round}-${state.players.bottom.turns}${state.players.top.turns}-${state.nextUid}.png`,
          ),
        ]
      : [],
  };
}

export function renderBattleEnd(screen: BattleScreen, summary: string) {
  const { state, viewer } = screen;
  const won = state.winner === viewer;
  const draw = state.winner === "draw";
  return {
    content: "",
    embeds: [
      embed(
        screen,
        draw ? "🤝 A draw" : won ? "🏆 Victory" : "💀 Defeat",
        draw
          ? EMBED_COLOR.neutral
          : won
            ? EMBED_COLOR.victory
            : EMBED_COLOR.defeat,
        summary,
      ),
    ],
    components: [] as ActionRowBuilder<ButtonBuilder>[],
    files: screen.image
      ? [attach(screen.image, `battle-${screen.id}-end.png`)]
      : [],
  };
}

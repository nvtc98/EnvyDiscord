import { randomBytes } from "node:crypto";
import { MessageFlags } from "discord.js";
import { playAiTurn, type Difficulty } from "../../engine/ai";
import { describeEvents } from "../../engine/events";
import {
  canPlay,
  endTurn,
  forfeit,
  newGame,
  playCard,
} from "../../engine/rules";
import type { GameEvent, GameState, LaneIndex } from "../../engine/types";
import type { VariantId } from "../../data/variants";
import { opponentDeck, resolveDeck } from "../../game/deck";
import { applyBattleResult, type Outcome } from "../../game/rewards";
import {
  renderBattle,
  renderBattleEnd,
  battleComponents,
  type BattleScreen,
} from "../battle-view";
import { slash, type AppContext, type Command } from "../command";
import { tryRender } from "../images";
import { isOwner } from "../owner";

interface Session {
  id: string;
  state: GameState;
  difficulty: Difficulty;
  selectedUid: number | null;
  /** Active variant of every card in the player's collection, for drawing. */
  variants: Record<string, VariantId>;
  log: string[];
  touched: number;
}

/** Battles live in memory only, one per user. A restart drops unfinished battles. */
const sessions = new Map<string, Session>();
const IDLE_MS = 30 * 60 * 1000;
const MAX_LOG_LINES = 14;

function purgeIdle(now: number): void {
  for (const [userId, session] of sessions) {
    if (now - session.touched > IDLE_MS) sessions.delete(userId);
  }
}

/** Engine events reduced to ids, so the log stays small and can be replayed. */
function compactEvent(event: GameEvent): Record<string, unknown> {
  const e = event as Record<string, unknown>;
  const out: Record<string, unknown> = { ...e };
  if ("card" in e) out.card = (e.card as { id: string }).id;
  if ("destroyed" in e && e.destroyed)
    out.destroyed = {
      card: (e.destroyed as { card: { id: string } }).card.id,
      owner: (e.destroyed as { owner: string }).owner,
    };
  return out;
}

function logEvents(
  ctx: AppContext,
  session: Session,
  userId: string,
  events: readonly GameEvent[],
): void {
  for (const event of events) {
    if (event.type === "drew" && event.seat === "top") continue; // the enemy's draws carry no information worth keeping
    ctx.log.game("battle_event", {
      userId,
      battleId: session.id,
      ...compactEvent(event),
    });
  }
}

/** Plays the AI's turns until it is the human's turn again (or the game ends). */
function advanceAi(session: Session, ctx: AppContext): GameEvent[] {
  const events: GameEvent[] = [];
  while (!session.state.winner && session.state.active === "top") {
    const step = playAiTurn(session.state, session.difficulty, ctx.rng);
    session.state = step.state;
    events.push(...step.events);
  }
  return events;
}

const screenOf = (session: Session): BattleScreen => ({
  id: session.id,
  state: session.state,
  viewer: "bottom",
  selectedUid: session.selectedUid,
  log: session.log,
});

async function withImage(
  ctx: AppContext,
  session: Session,
): Promise<BattleScreen> {
  const image = await tryRender(ctx, (r) =>
    r.battle({
      state: session.state,
      viewer: "bottom",
      selectedUid: session.selectedUid,
      variants: session.variants,
    }),
  );
  return { ...screenOf(session), image: image ?? undefined };
}

const pushLog = (session: Session, lines: string[]) => {
  session.log = lines.slice(-MAX_LOG_LINES);
};

export const battleCommand: Command = {
  data: slash("battle", "Fight the AI in a lane battle").addStringOption(
    (option) =>
      option
        .setName("difficulty")
        .setDescription("AI difficulty (default: normal)")
        .addChoices(
          { name: "Easy", value: "easy" },
          { name: "Normal", value: "normal" },
          { name: "Hard", value: "hard" },
        ),
  ),

  async execute(interaction, ctx) {
    // Practice battles are for the owner while the story is being built; players reach battles through /story.
    if (!(await isOwner(interaction.client, interaction.user.id))) {
      await interaction.reply({
        content: "Battles are part of the story now. Use `/story` to continue.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const player = ctx.repo.get(interaction.user.id);
    const difficulty = (interaction.options.getString("difficulty") ??
      "normal") as Difficulty;
    const deck = resolveDeck(player, ctx.cards, ctx.cardIndex, ctx.rng);
    const enemyDeck = opponentDeck(ctx.cards, ctx.rng);
    const first = ctx.rng() < 0.5 ? "bottom" : "top";

    const now = Date.now();
    purgeIdle(now);
    const game = newGame(
      { bottom: deck.cards, top: enemyDeck },
      first,
      ctx.rng,
    );
    const session: Session = {
      id: randomBytes(3).toString("hex"),
      state: game.state,
      difficulty,
      selectedUid: null,
      variants: Object.fromEntries(
        Object.entries(player.cards).map(([id, owned]) => [id, owned.active]),
      ),
      log: [],
      touched: now,
    };
    const opening = [
      first === "bottom" ? "You go first." : "The enemy goes first.",
      ...(deck.guests.length > 0
        ? [
            `${deck.guests.length} guest card${deck.guests.length === 1 ? "" : "s"} fill your deck for this battle. They are not added to your collection.`,
          ]
        : []),
    ];
    const aiEvents = advanceAi(session, ctx);
    pushLog(session, [...opening, ...describeEvents(aiEvents, "bottom")]);
    sessions.set(interaction.user.id, session);

    ctx.log.game("battle_started", {
      userId: interaction.user.id,
      username: interaction.user.username,
      battleId: session.id,
      difficulty,
      first,
      deck: deck.cards.map((c) => c.id),
      guests: deck.guests.map((c) => c.id),
      enemyDeck: enemyDeck.map((c) => c.id),
    });
    logEvents(ctx, session, interaction.user.id, aiEvents);

    await interaction.reply({
      ...renderBattle(await withImage(ctx, session)),
      flags: MessageFlags.Ephemeral,
    });
  },

  async component(interaction, ctx) {
    const [, battleId, kind, arg] = interaction.customId.split(":");
    const userId = interaction.user.id;
    const session = sessions.get(userId);

    if (!session || session.id !== battleId) {
      await interaction.update({
        content:
          "⌛ This battle has ended or expired. Use `/battle` to play again.",
        embeds: [],
        components: [],
        attachments: [],
      });
      return;
    }
    session.touched = Date.now();

    // Picking a card only changes the controls, so the image is left alone and the click feels instant.
    if (interaction.isStringSelectMenu() && kind === "pick") {
      const uid = Number(interaction.values[0]);
      session.selectedUid = session.state.players.bottom.hand.some(
        (c) => c.uid === uid,
      )
        ? uid
        : null;
      await interaction.update({
        components: battleComponents(screenOf(session)),
      });
      return;
    }
    if (!interaction.isButton()) return;

    const reject = (content: string) =>
      interaction.reply({ content, flags: MessageFlags.Ephemeral });

    let events: GameEvent[] = [];
    if (kind === "lane") {
      const lane = Number(arg) as LaneIndex;
      const uid = session.selectedUid;
      if (uid === null || !canPlay(session.state, uid, lane).ok) {
        await reject("You can't play that card there right now.");
        return;
      }
      const step = playCard(session.state, uid, lane);
      session.state = step.state;
      session.selectedUid = null;
      events = step.events;
      pushLog(session, describeEvents(events, "bottom"));
    } else if (kind === "end") {
      if (session.state.active !== "bottom" || session.state.winner) {
        await reject("It isn't your turn.");
        return;
      }
      ctx.log.game("battle_event", {
        userId,
        battleId,
        type: "turn_ended",
        seat: "bottom",
        round: session.state.round,
      });
      const own = endTurn(session.state);
      session.state = own.state;
      session.selectedUid = null;
      events = [...own.events, ...advanceAi(session, ctx)];
      pushLog(session, describeEvents(events, "bottom"));
    } else if (kind === "forfeit") {
      const step = forfeit(session.state, "bottom");
      session.state = step.state;
      events = step.events;
      pushLog(session, ["You forfeited."]);
    } else {
      return;
    }
    logEvents(ctx, session, userId, events);

    if (!session.state.winner) {
      // `attachments: []` drops the previous image so only the new one stays.
      await interaction.update({
        ...renderBattle(await withImage(ctx, session)),
        attachments: [],
      });
      return;
    }

    sessions.delete(userId);
    const outcome: Outcome =
      session.state.winner === "bottom"
        ? "won"
        : session.state.winner === "top"
          ? "lost"
          : "draw";
    const player = ctx.repo.get(userId);
    const coins = applyBattleResult(player, session.difficulty, outcome);
    await ctx.repo.save(player);
    ctx.log.game("battle_ended", {
      userId,
      battleId,
      difficulty: session.difficulty,
      winner: session.state.winner,
      rounds: session.state.round,
      forfeited: kind === "forfeit",
      coinsAwarded: coins,
      coinsTotal: player.coins,
    });
    const summary =
      outcome === "won"
        ? `You won! **+${coins} coins**`
        : outcome === "draw"
          ? `A draw. **+${coins} coins**`
          : `You lost. **+${coins} coins** as consolation.`;
    await interaction.update({
      ...renderBattleEnd(await withImage(ctx, session), summary),
      attachments: [],
    });
  },
};

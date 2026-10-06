import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { MessageFlags, type MessageComponentInteraction } from "discord.js";
import { type Difficulty } from "../engine/ai";
import { advanceAiBeats } from "../engine/ai-playback";
import { describeEvents } from "../engine/events";
import { canPlay, endTurn, forfeit, newGame, playCard } from "../engine/rules";
import type {
  CardDef,
  GameEvent,
  GameState,
  LaneIndex,
  Seat,
} from "../engine/types";
import type { VariantId } from "../data/variants";
import { applyBattleResult, type Outcome } from "../game/rewards";
import { ArtLibrary } from "../render/art";
import { loadPlayerAvatar, type AvatarImage } from "../render/avatar";
import type { StoryBattleState } from "../story/types";
import {
  renderBattle,
  renderBattleEnd,
  battleComponents,
  type BattleScreen,
} from "./battle-view";
import type { AppContext } from "./command";
import { tryRender } from "./images";

export interface Session {
  id: string;
  state: GameState;
  difficulty: Difficulty;
  selectedUid: number | null;
  /** Active variant of every card in the player's collection, for drawing. */
  variants: Record<string, VariantId>;
  log: string[];
  touched: number;
  userId: string;
  /** Where this battle came from. Only the game-over branch differs by origin. */
  origin: "practice" | "story";
  /** Portrait asset key, e.g. "enemy1"; null = placeholder. */
  opponentPortrait: string | null;
  /** The viewer's Discord avatar URL (source for the decode); null = no avatar. */
  playerAvatarUrl: string | null;
  /** Decoded-once cache: undefined = not yet fetched, null = fetch failed. */
  playerAvatarImage?: AvatarImage | null;
  /** For story battles: the sole owner of the story-side end work (set at launch). */
  onStoryEnd?: (
    session: Session,
    outcome: Outcome,
    interaction: MessageComponentInteraction,
  ) => Promise<void>;
}

/** Battles live in memory only, one per user. A restart drops unfinished battles. */
export const sessions = new Map<string, Session>();
export const IDLE_MS = 30 * 60 * 1000;
export const MAX_LOG_LINES = 14;

// The opponent portrait library (mtime-cached, downscaled to 640), pointed at assets/portraits.
const portraitLib = new ArtLibrary(
  join(fileURLToPath(new URL("../../assets", import.meta.url)), "portraits"),
);

/** How long each beat of the opponent's animated turn lingers so the player can read it. */
const STEP_DELAY_MS = 1400;
/** Mutable so tests can set it to 0 and run without real timers. */
let stepDelayMs = STEP_DELAY_MS;
/** Test hook: set the per-beat animation delay (use 0 in tests to skip real timers). */
export const setBattleStepDelay = (ms: number): void => {
  stepDelayMs = ms;
};
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function purgeIdle(now: number): void {
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

export function logEvents(
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

/**
 * Advances the AI's turns until it is the human's turn again (or the game ends), applying the final
 * state to the session at once (no animation). Used for the opening, where the enemy's first move is
 * shown instantly. Returns every event in order, for logging.
 */
export function advanceAi(session: Session, ctx: AppContext): GameEvent[] {
  const playback = advanceAiBeats(
    session.state,
    session.difficulty,
    ctx.rng,
    "bottom",
  );
  session.state = playback.finalState;
  return playback.events;
}

export const screenOf = (
  session: Session,
  state: GameState = session.state,
): BattleScreen => ({
  id: session.id,
  state,
  viewer: "bottom",
  selectedUid: session.selectedUid,
  log: session.log,
});

/**
 * Bakes the board image for a given state into a BattleScreen. Defaults to the session's current
 * state; the animation passes an intermediate beat state so each frame renders its own board. When
 * the renderer is absent `tryRender` returns null and `renderBattle` falls back to the text board.
 */
export async function withImage(
  ctx: AppContext,
  session: Session,
  state: GameState = session.state,
): Promise<BattleScreen> {
  // Decode the player avatar once and cache it (undefined = not yet fetched, null = fetch failed,
  // so a failed fetch is not retried every render). The opponent portrait is mtime-cached by ArtLibrary.
  if (session.playerAvatarImage === undefined)
    session.playerAvatarImage = await loadPlayerAvatar(session.playerAvatarUrl);
  const opponentAvatar = session.opponentPortrait
    ? await portraitLib.get(session.opponentPortrait)
    : null;
  const image = await tryRender(ctx, (r) =>
    r.battle({
      state,
      viewer: "bottom",
      selectedUid: session.selectedUid,
      variants: session.variants,
      playerAvatar: session.playerAvatarImage ?? null,
      opponentAvatar,
    }),
  );
  return { ...screenOf(session, state), image: image ?? undefined };
}

export const pushLog = (session: Session, lines: string[]): void => {
  session.log = lines.slice(-MAX_LOG_LINES);
};

/** For a story battle, mirror the live session into the DB so a resume can rebuild the board. */
async function mirrorStoryBattle(
  ctx: AppContext,
  session: Session,
): Promise<void> {
  if (session.origin !== "story") return;
  const player = ctx.repo.get(session.userId);
  if (!player.story?.battle) return;
  player.story.battle = toStoryBattleState(session);
  await ctx.repo.save(player);
}

export interface StartBattleOpts {
  ctx: AppContext;
  userId: string;
  username: string;
  deck: CardDef[];
  opponentDeck: CardDef[];
  difficulty: Difficulty;
  variants: Record<string, VariantId>;
  guests?: CardDef[];
  first?: Seat;
  /** Where this battle came from. Defaults to "practice" (owner /battle). */
  origin?: "practice" | "story";
  /** Opponent portrait asset key (e.g. "enemy1"); null/omitted = placeholder. */
  opponentPortrait?: string | null;
  /** The viewer's Discord avatar URL; null/omitted = placeholder. */
  playerAvatarUrl?: string | null;
}

/**
 * Builds the GameState, runs the opening AI instantly, stores the session and logs `battle_started`.
 */
export function startBattle(opts: StartBattleOpts): Session {
  const { ctx } = opts;
  const first = opts.first ?? (ctx.rng() < 0.5 ? "bottom" : "top");
  const now = Date.now();
  purgeIdle(now);
  const game = newGame(
    { bottom: opts.deck, top: opts.opponentDeck },
    first,
    ctx.rng,
  );
  const guests = opts.guests ?? [];
  const session: Session = {
    id: randomBytes(3).toString("hex"),
    state: game.state,
    difficulty: opts.difficulty,
    selectedUid: null,
    variants: opts.variants,
    log: [],
    touched: now,
    userId: opts.userId,
    origin: opts.origin ?? "practice",
    opponentPortrait: opts.opponentPortrait ?? null,
    playerAvatarUrl: opts.playerAvatarUrl ?? null,
    playerAvatarImage: undefined,
  };
  const opening = [
    first === "bottom" ? "Thou goest first." : "The enemy goes first.",
    ...(guests.length > 0
      ? [
          `${guests.length} guest card${guests.length === 1 ? "" : "s"} fill thy deck for this battle. They are not added to thy collection.`,
        ]
      : []),
  ];
  const aiEvents = advanceAi(session, ctx);
  pushLog(session, [...opening, ...describeEvents(aiEvents, "bottom")]);
  sessions.set(opts.userId, session);

  ctx.log.game("battle_started", {
    userId: opts.userId,
    username: opts.username,
    battleId: session.id,
    difficulty: opts.difficulty,
    first,
    deck: opts.deck.map((c) => c.id),
    guests: guests.map((c) => c.id),
    enemyDeck: opts.opponentDeck.map((c) => c.id),
    origin: session.origin,
  });
  logEvents(ctx, session, opts.userId, aiEvents);
  return session;
}

/** Serialise the live session into the persisted StoryBattleState (variants/avatar are not stored). */
export function toStoryBattleState(session: Session): StoryBattleState {
  return {
    kind: "cave",
    state: structuredClone(session.state),
    selectedUid: session.selectedUid,
    log: [...session.log],
    difficulty: session.difficulty,
    opponentPortrait: session.opponentPortrait,
  };
}

/**
 * The shared battle component handler. Picking and playing a card update in place instantly; ending
 * the turn hands over to `animateEndOfTurn`; forfeiting ends the battle. The game-over branch awards
 * rewards and shows the end screen.
 */
export async function handleBattleComponent(
  interaction: MessageComponentInteraction,
  ctx: AppContext,
): Promise<void> {
  const [, battleId, kind, arg] = interaction.customId.split(":");
  const userId = interaction.user.id;
  const session = sessions.get(userId);

  if (!session || session.id !== battleId) {
    await interaction.update({
      content:
        "⌛ This battle hath ended or passed away. Speak `/battle` to fight anew.",
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
      await reject("Thou canst not play that card there at this moment.");
      return;
    }
    const step = playCard(session.state, uid, lane);
    session.state = step.state;
    session.selectedUid = null;
    events = step.events;
    pushLog(session, describeEvents(events, "bottom"));
  } else if (kind === "end") {
    if (session.state.active !== "bottom" || session.state.winner) {
      await reject("'Tis not thy turn.");
      return;
    }
    await animateEndOfTurn(interaction, ctx, session, battleId, userId, kind);
    return;
  } else if (kind === "forfeit") {
    const step = forfeit(session.state, "bottom");
    session.state = step.state;
    events = step.events;
    pushLog(session, ["Thou hast yielded."]);
  } else {
    return;
  }
  logEvents(ctx, session, userId, events);

  if (!session.state.winner) {
    await mirrorStoryBattle(ctx, session);
    // `attachments: []` drops the previous image so only the new one stays.
    await interaction.update({
      ...renderBattle(await withImage(ctx, session)),
      attachments: [],
    });
    return;
  }

  await finishBattle(interaction, ctx, session, battleId, userId, kind, (p) =>
    interaction.update(p),
  );
}

/**
 * Resolves a finished battle: deletes the session (so a repeat press hits the "battle ended" path and
 * rewards are awarded once), runs rewards + logging, and sends the end screen through `send`
 * (`interaction.update` for the instant path, `interaction.editReply` for the animated end-of-turn
 * path). The caller must only invoke this when `session.state.winner` is set.
 */
async function finishBattle(
  interaction: MessageComponentInteraction,
  ctx: AppContext,
  session: Session,
  battleId: string,
  userId: string,
  kind: string,
  send: (payload: Record<string, unknown>) => Promise<unknown>,
): Promise<void> {
  // Game over. Delete the session first so a repeat press hits the "battle ended" path (award-once).
  sessions.delete(userId);
  const outcome: Outcome =
    session.state.winner === "bottom"
      ? "won"
      : session.state.winner === "top"
        ? "lost"
        : "draw";

  // Story battles hand ALL end work to the injected callback (reward + node move + end screen +
  // next scene). It lives in story-battle.ts, the sole importer of both this module and the story
  // engine/delivery, so battle-session never imports the story layer (no cycle).
  if (session.origin === "story" && session.onStoryEnd) {
    await session.onStoryEnd(session, outcome, interaction);
    return;
  }

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
      ? `Victory is thine! **+${coins} coins**`
      : outcome === "draw"
        ? `A draw. **+${coins} coins**`
        : `Thou art bested. **+${coins} coins** for thy trouble.`;
  await send({
    ...renderBattleEnd(await withImage(ctx, session), summary),
    attachments: [],
  });
}

/**
 * Plays the opponent's turn back as an animated sequence inside the same ephemeral message. The human
 * has just pressed "End the turn" on their own turn: we end their turn, advance the AI, then step
 * through the opponent's beats ~1.4s apart, re-rendering BOTH the board image and the log embed each
 * time. The engine state is advanced to its authoritative final value up front, so a dropped
 * intermediate frame costs only an animation step, never game integrity. When done, controls return
 * (or the end screen shows if the game ended).
 */
async function animateEndOfTurn(
  interaction: MessageComponentInteraction,
  ctx: AppContext,
  session: Session,
  battleId: string,
  userId: string,
  kind: string,
): Promise<void> {
  ctx.log.game("battle_event", {
    userId,
    battleId,
    type: "turn_ended",
    seat: "bottom",
    round: session.state.round,
  });

  const preTurnLog = [...session.log];
  const own = endTurn(session.state);
  session.selectedUid = null;
  const playback = advanceAiBeats(
    own.state,
    session.difficulty,
    ctx.rng,
    "bottom",
  );
  // Advance to the authoritative final state at once; the animation is purely presentational.
  session.state = playback.finalState;
  const events = [...own.events, ...playback.events];
  logEvents(ctx, session, userId, events);

  // The human's own end-turn produces no visible line; it just hands over to the opponent.
  // Beats come from the opponent's turn; keep only those with something to show.
  const ownLines = describeEvents(own.events, "bottom");
  const visibleBeats = playback.beats.filter((b) => b.lines.length > 0);

  // The final log the session should settle on (matches the old non-animated result, trimmed).
  const allLines = [...ownLines, ...playback.beats.flatMap((b) => b.lines)];

  const myId = session.id;
  const stillMine = () => sessions.get(userId)?.id === myId;

  // No visible beats (shouldn't happen for a real AI turn): skip animation, do one final render.
  if (visibleBeats.length === 0) {
    pushLog(session, [...preTurnLog, ...allLines]);
    await finalRender(interaction, ctx, session, battleId, userId, kind, (p) =>
      interaction.update(p),
    );
    return;
  }

  // Running log that grows one beat at a time, mirroring the old per-step append.
  const runningLines = [...preTurnLog, ...ownLines];

  // Beat 0: acknowledge the button and strip all controls while the opponent acts.
  const first = visibleBeats[0];
  runningLines.push(...first.lines);
  pushLog(session, runningLines);
  try {
    const screen = await withImage(ctx, session, first.state);
    await interaction.update({
      ...renderBattle(screen),
      components: [],
      attachments: [],
    });
  } catch {
    // If even the acknowledge fails, bail to a best-effort final render below.
  }

  // Subsequent beats: wait, then edit the same message in place.
  for (let i = 1; i < visibleBeats.length; i++) {
    await delay(stepDelayMs);
    if (!stillMine()) return; // a second /battle replaced this session mid-animation
    const beat = visibleBeats[i];
    runningLines.push(...beat.lines);
    pushLog(session, runningLines);
    try {
      const screen = await withImage(ctx, session, beat.state);
      await interaction.editReply({
        ...renderBattle(screen),
        components: [],
        attachments: [],
      });
    } catch {
      break; // a dropped frame is fine; the state is already authoritative
    }
  }

  // Settle the log on exactly what the non-animated path would show.
  pushLog(session, [...preTurnLog, ...allLines]);
  if (!stillMine()) return;
  await finalRender(interaction, ctx, session, battleId, userId, kind, (p) =>
    interaction.editReply(p),
  );
}

/**
 * The frame shown after the animation: controls restored (`renderBattle`) if the game continues, or
 * the end screen if it is over. Guarded so a stray edit error never strands the player in a
 * controls-less view.
 */
async function finalRender(
  interaction: MessageComponentInteraction,
  ctx: AppContext,
  session: Session,
  battleId: string,
  userId: string,
  kind: string,
  send: (payload: Record<string, unknown>) => Promise<unknown>,
): Promise<void> {
  try {
    if (!session.state.winner) {
      await mirrorStoryBattle(ctx, session);
      await send({
        ...renderBattle(await withImage(ctx, session)),
        attachments: [],
      });
      return;
    }
    await finishBattle(interaction, ctx, session, battleId, userId, kind, send);
  } catch {
    // Last-ditch: never leave the player stuck without controls.
  }
}

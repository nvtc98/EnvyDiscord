import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { MessageFlags, type MessageComponentInteraction } from "discord.js";
import { type Difficulty } from "../engine/ai";
import { advanceAiBeats } from "../engine/ai-playback";
import { describeEvents } from "../engine/events";
import { canPlay, endTurn, forfeit, newGame, playCard } from "../engine/rules";
import { seedGuaranteedOpening } from "../engine/opening";
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
  /** Raw player HUD name; renderer falls back to "You" when absent. */
  playerName?: string;
  /** Raw opponent HUD name; renderer falls back to "The Enemy" when absent. */
  opponentName?: string;
  /** For story battles: the sole owner of the story-side end work (set at launch). */
  onStoryEnd?: (
    session: Session,
    outcome: Outcome,
    interaction: MessageComponentInteraction,
  ) => Promise<void>;
  /** structuredClone of GameState captured when control last returned to the human, for Reset turn. */
  turnSnapshot: GameState | null;
  /** The log as it stood when control last returned to the human, restored on Reset turn. */
  turnStartLog: string[] | null;
}

/**
 * Whether the human has changed anything this turn (plays spend energy and/or shrink the hand; a
 * draw or Phoenix rebirth mints a new uid). Single source of truth for both canReset and the reset
 * guard; never an identity comparison (meaningless after a clone).
 */
function humanActedThisTurn(cur: GameState, snap: GameState): boolean {
  const c = cur.players.bottom,
    s = snap.players.bottom;
  return (
    c.hand.length !== s.hand.length ||
    c.energy !== s.energy ||
    cur.nextUid !== snap.nextUid
  );
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
  playerName: session.playerName,
  opponentName: session.opponentName,
  canReset:
    session.turnSnapshot !== null &&
    session.state.active === "bottom" &&
    session.state.winner === null &&
    humanActedThisTurn(session.state, session.turnSnapshot),
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
      playerName: session.playerName,
      opponentName: session.opponentName,
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
  /** Card ids to force into the opponent's (top seat) opening hand. Omitted = none. GENERAL per-NPC. */
  opponentGuaranteedOpening?: readonly string[];
  /** true = the opponent (top seat) takes the first turn, unless an explicit `first` overrides it. GENERAL per-NPC. */
  opponentGoesFirst?: boolean;
  /** Where this battle came from. Defaults to "practice" (owner /battle). */
  origin?: "practice" | "story";
  /** Opponent portrait asset key (e.g. "enemy1"); null/omitted = placeholder. */
  opponentPortrait?: string | null;
  /** The viewer's Discord avatar URL; null/omitted = placeholder. */
  playerAvatarUrl?: string | null;
  /** Raw player HUD name; omitted = renderer's "You" default. */
  playerName?: string;
  /** Raw opponent HUD name; omitted = renderer's "The Enemy" default. */
  opponentName?: string;
}

/**
 * Builds the GameState, runs the opening AI instantly, stores the session and logs `battle_started`.
 */
export function startBattle(opts: StartBattleOpts): Session {
  const { ctx } = opts;
  // An explicit `first` always wins; else `opponentGoesFirst` forces "top"; else the random default.
  // When `opponentGoesFirst` resolves the seat, ctx.rng() is NOT consumed (preserves the stream for
  // callers that do not opt in; /battle never sets it, so its random first-mover is unchanged).
  const first: Seat =
    opts.first ??
    (opts.opponentGoesFirst ? "top" : ctx.rng() < 0.5 ? "bottom" : "top");
  const now = Date.now();
  purgeIdle(now);
  const game = newGame(
    { bottom: opts.deck, top: opts.opponentDeck },
    first,
    ctx.rng,
  );
  // Seed the opponent's guaranteed opening cards AFTER the deal and BEFORE advanceAi runs below, so if
  // the NPC moves first it already holds the guaranteed card when its opening turn plays. HOLD only.
  if (opts.opponentGuaranteedOpening?.length)
    seedGuaranteedOpening(game.state, "top", opts.opponentGuaranteedOpening);
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
    playerName: opts.playerName,
    opponentName: opts.opponentName,
    turnSnapshot: null,
    turnStartLog: null,
  };
  const opening = [
    first === "bottom" ? "You go first." : "The enemy goes first.",
    ...(guests.length > 0
      ? [
          `${guests.length} guest card${guests.length === 1 ? "" : "s"} fill your deck for this battle. They are not added to your collection.`,
        ]
      : []),
  ];
  const aiEvents = advanceAi(session, ctx);
  pushLog(session, [...opening, ...describeEvents(aiEvents, "bottom")]);
  // If control sits with the human after the opening, capture the pre-play snapshot for Reset turn.
  if (session.state.active === "bottom" && !session.state.winner) {
    session.turnSnapshot = structuredClone(session.state);
    session.turnStartLog = [...session.log];
  }
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
      content: "⌛ This battle has ended. Use `/battle` to start a new one.",
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
      await reject("It's not your turn.");
      return;
    }
    await animateEndOfTurn(interaction, ctx, session, battleId, userId, kind);
    return;
  } else if (kind === "forfeit") {
    const step = forfeit(session.state, "bottom");
    session.state = step.state;
    events = step.events;
    pushLog(session, ["You forfeited."]);
  } else if (kind === "reset") {
    if (
      session.state.active !== "bottom" ||
      session.state.winner ||
      session.turnSnapshot === null ||
      !humanActedThisTurn(session.state, session.turnSnapshot)
    ) {
      await reject("Nothing to reset.");
      return;
    }
    session.state = structuredClone(session.turnSnapshot);
    session.selectedUid = null;
    pushLog(session, session.turnStartLog ?? []);
    await mirrorStoryBattle(ctx, session);
    await interaction.update({
      ...renderBattle(await withImage(ctx, session)),
      attachments: [],
    });
    return;
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
    turns: session.state.turnsPlayed,
    forfeited: kind === "forfeit",
    coinsAwarded: coins,
    coinsTotal: player.coins,
  });
  const summary =
    outcome === "won"
      ? `You win! **+${coins} coins**`
      : outcome === "draw"
        ? `A draw. **+${coins} coins**`
        : `You lose. **+${coins} coins** for your trouble.`;
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
  const own = endTurn(session.state, ctx.rng);
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

  // The human's own end-turn now shifts the tide, so it always carries a visible line; it becomes
  // beat 0 (the human's own post-shift board). The AI's beats follow, filtered to drop empty ones.
  const ownLines = describeEvents(own.events, "bottom");
  const aiVisible = playback.beats.filter((b) => b.lines.length > 0);
  // Beat 0 is the human's own post-shift board (moved marker + own tide line); AI beats follow.
  // On a human-side game-over (knockout/cap on the human's own endTurn) there is no animation:
  // the end screen covers the board, so emit zero visible beats and let finalRender show it.
  const visibleBeats = own.state.winner
    ? []
    : [{ state: own.state, lines: ownLines }, ...aiVisible];

  // The final log the session should settle on (matches the old non-animated result, trimmed).
  const allLines = [...ownLines, ...playback.beats.flatMap((b) => b.lines)];

  const myId = session.id;
  const stillMine = () => sessions.get(userId)?.id === myId;

  // No visible beats now means the human's own endTurn finished the game (knockout/cap): skip
  // animation, do one final render — the end screen covers the board.
  if (visibleBeats.length === 0) {
    pushLog(session, [...preTurnLog, ...allLines]);
    await finalRender(interaction, ctx, session, battleId, userId, kind, (p) =>
      interaction.update(p),
    );
    return;
  }

  // Running log that grows one beat at a time, mirroring the old per-step append. ownLines now lives
  // inside beat 0 (pushed via first.lines below), so it must NOT be seeded here or it counts twice.
  const runningLines = [...preTurnLog];

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
      // Control is returning to the human: capture the pre-play snapshot for Reset turn.
      session.turnSnapshot =
        session.state.active === "bottom"
          ? structuredClone(session.state)
          : null;
      session.turnStartLog =
        session.state.active === "bottom" ? [...session.log] : null;
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

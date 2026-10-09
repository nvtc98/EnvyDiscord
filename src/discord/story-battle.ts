import { randomBytes } from "node:crypto";
import type { MessageComponentInteraction } from "discord.js";
import type { Player } from "../game/player";
import { resolveDeck } from "../game/deck";
import { NPC_INDEX, npcDeck } from "../data/npcs";
import { applyBattleResult, type Outcome } from "../game/rewards";
import { resolveStoryBattle } from "../story/engine";
import type { StoryBattleState } from "../story/types";
import { TUTORIAL_INTRO_LINE, tutorialLineFor } from "../story/tutorial";
import { renderBattle, renderBattleEnd } from "./battle-view";
import {
  animateOpeningTurn,
  opponentOpens,
  runBattleStartBeat,
  sessions,
  startBattle,
  toStoryBattleState,
  withImage,
  type AnimationSurface,
  type BattleDm,
  type OnBeat,
  type Session,
} from "./battle-session";
import type { AppContext } from "./command";
import {
  CONTINUE_ROW,
  deliverScene,
  recordLive,
  registerTutorialContinue,
  storyContext,
  storyTypingPause,
  type DmChannel,
} from "./commands/story";

/** The one-line caption on the finished board image (player-facing UI: archaic-but-plain, terse). */
const END_SUMMARY: Record<"won" | "lost", string> = {
  won: "The last card falls. The road opens.",
  lost: "The cards turn against you.",
};

/**
 * Builds the onStoryEnd callback for a story battle. It is the SOLE owner of the story-side end work
 * (so battle-session.ts need not import the story engine/delivery, which would re-create the cycle):
 * record the result, move the story node, show the final board, then deliver the next scene.
 */
function makeOnStoryEnd(ctx: AppContext, dm: DmChannel) {
  return async (
    session: Session,
    outcome: Outcome,
    interaction: MessageComponentInteraction,
  ): Promise<void> => {
    const player = ctx.repo.get(session.userId);
    const coins = applyBattleResult(player, session.difficulty, outcome);
    // A story battle is win/loss only; a draw is treated as a loss for the node transition.
    const resolved = outcome === "won" ? "won" : "lost";
    resolveStoryBattle(player, resolved, storyContext(ctx));
    await ctx.repo.save(player);
    ctx.log.game("battle_ended", {
      userId: session.userId,
      battleId: session.id,
      difficulty: session.difficulty,
      winner: session.state.winner,
      rounds: session.state.round,
      turns: session.state.turnsPlayed,
      forfeited: false,
      coinsAwarded: coins,
      coinsTotal: player.coins,
      origin: "story",
    });
    await interaction.update({
      ...renderBattleEnd(await withImage(ctx, session), END_SUMMARY[resolved]),
      attachments: [],
    });
    const user = interaction.user as {
      displayAvatarURL?: (opts?: unknown) => string;
    };
    const avatarUrl =
      typeof user.displayAvatarURL === "function"
        ? user.displayAvatarURL({ extension: "png", size: 128 })
        : null;
    await deliverScene(
      ctx,
      { id: session.userId, username: session.userId },
      player,
      dm,
      avatarUrl,
    );
  };
}

/**
 * The {@link BattleDm} the battle's re-anchor uses: `send` posts a fresh board and records its id as
 * the live board (via recordLive) so the battle's board id and the story's stale-button guard track
 * the SAME id (the re-anchor single-id invariant). `deleteMessage` wraps the DM channel delete, which
 * already swallows benign "already gone" errors inside `asDmChannel`.
 */
function buildBattleDm(
  dm: DmChannel,
  userId: string,
  player: Player,
): BattleDm {
  return {
    async send(payload) {
      const sent = await dm.send(payload);
      recordLive(userId, sent.id, player);
      return sent;
    },
    deleteMessage: (messageId) => dm.deleteMessage(messageId),
  };
}

/**
 * Builds the in-battle tutorial `onBeat`. It talks (one or more DM bubbles) then re-anchors the board
 * to the bottom — but ONLY on a beat with a lesson left to teach; a say-nothing beat returns early
 * (the fast path: no send, no reanchor, board updates in place). It NEVER touches `ev.interaction` —
 * the battle owns the single ack. Per-player teach-once flags live in `player.story.tutorial`, flipped
 * inside `tutorialLineFor`; we persist the player after setting them so a mid-battle restart does not
 * re-teach. Any throw here is caught + swallowed by the battle (the hook is auxiliary chatter).
 */
function makeTutorialOnBeat(
  ctx: AppContext,
  dm: DmChannel,
  player: Player,
): OnBeat {
  return async (ev) => {
    const lines = tutorialLineFor(ev, player); // may flip flags; null = silent this beat
    if (!lines || lines.length === 0) return; // fast path: no send, no button, no wait, no reanchor
    // Send each bubble; the LAST bubble carries a single "Continue" button so the player reads the
    // whole beat before the board returns. Earlier bubbles are plain.
    for (let i = 0; i < lines.length; i++) {
      const content = lines[i];
      const isLast = i === lines.length - 1;
      await dm.sendTyping();
      await storyTypingPause(content);
      await dm.send({
        content,
        allowedMentions: { parse: [] },
        ...(isLast ? { components: [CONTINUE_ROW()] } : {}),
      });
    }
    await ctx.repo.save(player); // persist the teach-once flag(s) just set
    // Register the Continue resolver BEFORE awaiting it, so a very fast press cannot arrive before
    // the resolver exists. Hold here with NO timeout until the player presses Continue (which strips
    // the button and resolves this promise via the story component handler). Only register when we
    // actually spoke, so a silent beat never leaves a dangling resolver.
    const wait = registerTutorialContinue(ev.session.userId);
    await wait;
    await ev.reanchor(); // only AFTER Continue: pull the board back below the lines
  };
}

/**
 * Launches (or resumes) the cave battle inside the DM. Called from deliverScene when the player enters
 * `cave_battle`. Branches RESUME (an unfinished saved game: rebuild the session verbatim) vs FRESH
 * (first entry, or a retry after a lost/cleared snapshot: resolve decks, start a new game).
 */
export async function launchStoryBattle(
  ctx: AppContext,
  user: { id: string; username: string },
  player: Player,
  dm: DmChannel,
  avatarUrl: string | null,
): Promise<void> {
  const onStoryEnd = makeOnStoryEnd(ctx, dm);
  const boSpd = NPC_INDEX.get("bo-spd");
  if (!boSpd) throw new Error('story cave battle: NPC "bo-spd" is not defined');

  // The in-battle tutorial attaches ONLY on the FIRST cave duel. `caveWon` flips true on the first win
  // (resolveStoryBattle), so a "Fight again" replay and any future /battle never attach dm/onBeat and
  // never post the intro line. Per-player teach-once flags (story.tutorial) additionally prevent any
  // lesson repeating across beats/resumes within that first duel.
  const tutorial = !player.story?.caveWon;

  // Already battling in memory — just re-send the current board.
  const live = sessions.get(user.id);
  if (live && live.origin === "story") {
    live.onStoryEnd = onStoryEnd;
    live.playerAvatarUrl = avatarUrl;
    live.playerName = player.story?.name ?? undefined;
    live.opponentName ??= boSpd.name;
    const sent = await dm.send(renderBattle(await withImage(ctx, live)));
    recordLive(user.id, sent.id, player);
    // LIVE-REUSE path: re-attach the tutorial hook after an in-memory reuse so chatter continues.
    if (tutorial) {
      live.dm = buildBattleDm(dm, user.id, player);
      live.boardMessageId = sent.id;
      live.onBeat = makeTutorialOnBeat(ctx, dm, player);
    }
    await ctx.repo.save(player);
    return;
  }

  const snap = player.story?.battle ?? null;
  const canResume = snap != null && snap.state.winner === null;

  if (canResume) {
    const session = rebuildSession(
      snap,
      user,
      player,
      avatarUrl,
      onStoryEnd,
      boSpd.name,
    );
    sessions.set(user.id, session);
    // Resume never animates: a rebuilt snapshot is already on the human's turn. Just re-send the board.
    const sent = await dm.send(renderBattle(await withImage(ctx, session)));
    recordLive(user.id, sent.id, player);
    // RESUME path: re-attach the hook so chatter continues mid-fight. Do NOT re-send the intro line and
    // do NOT re-fire battle-start — that already happened on the fresh launch, and the per-player
    // teach-once flags guard it anyway.
    if (tutorial) {
      session.dm = buildBattleDm(dm, user.id, player);
      session.boardMessageId = sent.id;
      session.onBeat = makeTutorialOnBeat(ctx, dm, player);
    }
    await ctx.repo.save(player);
    return;
  }

  // FRESH battle.
  const deck = resolveDeck(
    player,
    ctx.collectibleCards,
    ctx.cardIndex,
    ctx.rng,
  );
  const enemyDeck = npcDeck(boSpd, ctx.cardIndex);
  const session = startBattle({
    ctx,
    userId: user.id,
    username: user.username,
    deck: deck.cards,
    opponentDeck: enemyDeck,
    opponentGuaranteedOpening: boSpd.guaranteedOpening,
    opponentGoesFirst: boSpd.goesFirst,
    difficulty: "normal",
    variants: variantsOf(player),
    guests: deck.guests,
    origin: "story",
    opponentPortrait: boSpd.portrait,
    playerAvatarUrl: avatarUrl,
    playerName: player.story?.name ?? undefined,
    opponentName: boSpd.name,
  });
  session.onStoryEnd = onStoryEnd;
  // Mirror the (pre-opening) live session into the DB so a resume can rebuild.
  player.story!.battle = toStoryBattleState(session);

  const screen = renderBattle(await withImage(ctx, session));
  const opening = opponentOpens(session);
  // FRESH tutorial: the reassurance line is sent BEFORE the first board, so the player reads "I will
  // teach thee" first, then sees the board, then the battle-start lessons sit above it.
  if (tutorial) {
    await dm.sendTyping();
    await storyTypingPause(TUTORIAL_INTRO_LINE);
    await dm.send({
      content: TUTORIAL_INTRO_LINE,
      allowedMentions: { parse: [] },
    });
  }
  // Post the opening board CONTROL-LESS when the opponent opens (no button flash); otherwise WITH controls.
  const sent = await dm.send(opening ? { ...screen, components: [] } : screen);
  const liveId = sent.id;
  recordLive(user.id, liveId, player);
  // Pre-opening save: a crash DURING the animation still leaves a resumable (enemy-start) snapshot.
  await ctx.repo.save(player);

  // FRESH tutorial wiring: attach dm/boardMessageId/onBeat, THEN fire battle-start ONCE — before the
  // opening animation, so the battle-start lessons precede Bò SPD's opening move. runBattleStartBeat
  // requires dm + boardMessageId already set (its re-anchor target).
  if (tutorial) {
    session.dm = buildBattleDm(dm, user.id, player);
    session.boardMessageId = liveId;
    session.onBeat = makeTutorialOnBeat(ctx, dm, player);
    await runBattleStartBeat(ctx, session);
  }

  if (opening) {
    const surface: AnimationSurface = {
      interaction: null,
      // Frame 0 (the enemy's opening card on the board) edits the control-less board in place.
      showFirstFrame: async (p) => {
        await dm.edit(session.boardMessageId ?? liveId, {
          ...p,
          components: [],
          attachments: [],
        });
      },
      editFrame: async (p) => {
        await dm.edit(session.boardMessageId ?? liveId, {
          ...p,
          components: [],
          attachments: [],
        });
      },
      // Final board WITH controls: components NOT stripped; attachments dropped so no second image stacks.
      showControls: async (p) => {
        await dm.edit(session.boardMessageId ?? liveId, {
          ...p,
          attachments: [],
        });
      },
    };
    await animateOpeningTurn(ctx, session, surface);
    // NO extra save here: animateOpeningTurn -> restoreHumanControls -> mirrorStoryBattle re-mirrors the
    // POST-opening state and saves it. A trailing save of this stale `player` would clobber that mirror.
  }
}

/** Active variant of each owned card, by card id (same as /battle). */
function variantsOf(player: Player): Record<string, string> {
  return Object.fromEntries(
    Object.entries(player.cards).map(([id, owned]) => [id, owned.active]),
  );
}

/** Rebuild a live Session from the persisted snapshot (variants recomputed, avatar re-decoded once). */
function rebuildSession(
  snap: StoryBattleState,
  user: { id: string; username: string },
  player: Player,
  avatarUrl: string | null,
  onStoryEnd: Session["onStoryEnd"],
  opponentName: string,
): Session {
  return {
    id: randomBytes(3).toString("hex"),
    state: structuredClone(snap.state),
    difficulty: snap.difficulty,
    selectedUid: snap.selectedUid,
    variants: variantsOf(player),
    log: [...snap.log],
    touched: Date.now(),
    origin: "story",
    userId: user.id,
    opponentPortrait: snap.opponentPortrait,
    playerAvatarUrl: avatarUrl,
    playerAvatarImage: undefined,
    playerName: player.story?.name ?? undefined,
    opponentName,
    onStoryEnd,
    turnSnapshot: null,
    turnStartLog: null,
  };
}

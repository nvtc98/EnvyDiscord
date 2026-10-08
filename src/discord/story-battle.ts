import { randomBytes } from "node:crypto";
import type { MessageComponentInteraction } from "discord.js";
import type { Player } from "../game/player";
import { resolveDeck } from "../game/deck";
import { NPC_INDEX, npcDeck } from "../data/npcs";
import { applyBattleResult, type Outcome } from "../game/rewards";
import { resolveStoryBattle } from "../story/engine";
import type { StoryBattleState } from "../story/types";
import { renderBattle, renderBattleEnd } from "./battle-view";
import {
  animateOpeningTurn,
  opponentOpens,
  sessions,
  startBattle,
  toStoryBattleState,
  withImage,
  type AnimationSurface,
  type Session,
} from "./battle-session";
import type { AppContext } from "./command";
import {
  deliverScene,
  recordLive,
  storyContext,
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

  // Already battling in memory — just re-send the current board.
  const live = sessions.get(user.id);
  if (live && live.origin === "story") {
    live.onStoryEnd = onStoryEnd;
    live.playerAvatarUrl = avatarUrl;
    live.playerName = player.story?.name ?? undefined;
    live.opponentName ??= boSpd.name;
    const sent = await dm.send(renderBattle(await withImage(ctx, live)));
    recordLive(user.id, sent.id, player);
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
  // Post the opening board CONTROL-LESS when the opponent opens (no button flash); otherwise WITH controls.
  const sent = await dm.send(opening ? { ...screen, components: [] } : screen);
  const liveId = sent.id;
  recordLive(user.id, liveId, player);
  // Pre-opening save: a crash DURING the animation still leaves a resumable (enemy-start) snapshot.
  await ctx.repo.save(player);

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

import type { Player } from "../game/player";
import { NODES } from "./prologue";
import type {
  StoryAction,
  StoryContext,
  StoryEvent,
  StoryState,
  StoryView,
} from "./types";

export const START_NODE = "greeting";

export const freshStory = (): StoryState => ({
  node: START_NODE,
  name: null,
  isEye: null,
  knowsTribe: null,
  nameAttempts: [],
  pendingName: null,
  notice: null,
  pack: null,
  starterClaimed: false,
  liveMessageId: null,
  chapter: null,
  battle: null,
  caveWon: false,
  awaitingDaily: false,
  tutorial: {},
});

/** Starts the story for a player who has none. Returns the events that happened. */
export function ensureStory(player: Player, ctx: StoryContext): StoryEvent[] {
  if (player.story) {
    // Back-fill fields added after this player's story was first saved, so no reader faces `undefined`.
    player.story.chapter ??= null;
    player.story.battle ??= null;
    player.story.caveWon ??= false;
    player.story.awaitingDaily ??= false;
    player.story.tutorial ??= {};
    return [];
  }
  player.story = freshStory();
  const events: StoryEvent[] = [{ type: "node", node: START_NODE }];
  NODES[START_NODE].onEnter?.(player, ctx, events);
  return events;
}

/** What the player sees now. The one-off reaction to their last action (the notice) comes first. */
export function currentView(player: Player, ctx: StoryContext): StoryView {
  const story = player.story;
  if (!story) throw new Error("The story has not been started");
  const node = NODES[story.node];
  if (!node) throw new Error(`Unknown story scene "${story.node}"`);
  const view = node.view(player, ctx);
  return story.notice
    ? { ...view, lines: [story.notice, ...view.lines] }
    : view;
}

export type ApplyResult =
  | { ok: true; events: StoryEvent[] }
  | { ok: false; reason: "no-story" | "stale" | "invalid" };

/**
 * Applies a button press or a submitted form to the scene the player is in. `nodeId` is the scene the message was
 * showing: if the player has moved on since (an old message, a double click) nothing happens and `stale` is returned.
 */
export function applyAction(
  player: Player,
  nodeId: string,
  action: StoryAction,
  ctx: StoryContext,
): ApplyResult {
  const story = player.story;
  if (!story) return { ok: false, reason: "no-story" };
  if (story.node !== nodeId) return { ok: false, reason: "stale" };

  const node = NODES[story.node];
  const events: StoryEvent[] = [];
  const view = node.view(player, ctx);
  let next: string;

  if (action.type === "choice") {
    if (
      !node.choose ||
      !Number.isInteger(action.index) ||
      action.index < 0 ||
      action.index >= view.choices.length
    )
      return { ok: false, reason: "invalid" };
    story.notice = null;
    next = node.choose(player, action.index, ctx, events);
  } else {
    if (!node.submit) return { ok: false, reason: "invalid" };
    story.notice = null;
    next = node.submit(player, action.text, ctx, events);
  }

  if (!NODES[next])
    throw new Error(`Scene "${story.node}" led to unknown scene "${next}"`);
  if (next !== story.node) {
    story.node = next;
    events.push({ type: "node", node: next });
    NODES[next].onEnter?.(player, ctx, events);
  }
  return { ok: true, events };
}

/**
 * Called by the battle driver when a story battle finishes. Advances to the win (`chapter_end`) or
 * loss (`cave_loss`) node. Pure: it only moves the node and flags and runs onEnter — coin/win-loss
 * recording stays in the Discord driver, exactly as /battle does. A win clears the saved battle; a
 * loss keeps it so a retry can discard it explicitly.
 */
export function resolveStoryBattle(
  player: Player,
  outcome: "won" | "lost",
  ctx: StoryContext,
): ApplyResult {
  const story = player.story;
  if (!story) return { ok: false, reason: "no-story" };
  if (story.node !== "cave_battle" || story.battle === null)
    return { ok: false, reason: "invalid" };

  story.notice = null;
  const next = outcome === "won" ? "victory_praise" : "cave_loss";
  if (outcome === "won") {
    story.caveWon = true;
    story.battle = null;
  }
  story.node = next;
  const events: StoryEvent[] = [{ type: "node", node: next }];
  NODES[next].onEnter?.(player, ctx, events);
  return { ok: true, events };
}

/**
 * When the player is parked at `victory_roster` waiting on /daily, advance the story once to
 * `victory_daily_done` (running its onEnter, which clears the wait flag). Returns true only when it
 * actually advanced, so a normal later /daily — on a player no longer parked (node moved past
 * `victory_roster`, or the flag already false) — is a no-op and never re-triggers the story.
 */
export function advanceParkedDaily(player: Player, ctx: StoryContext): boolean {
  const story = player.story;
  if (!story || story.node !== "victory_roster" || !story.awaitingDaily)
    return false;
  story.notice = null;
  story.node = "victory_daily_done";
  const events: StoryEvent[] = [{ type: "node", node: "victory_daily_done" }];
  NODES["victory_daily_done"].onEnter?.(player, ctx, events); // clears awaitingDaily
  return true;
}

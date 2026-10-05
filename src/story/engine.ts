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
});

/** Starts the story for a player who has none. Returns the events that happened. */
export function ensureStory(player: Player, ctx: StoryContext): StoryEvent[] {
  if (player.story) return [];
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

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  DiscordAPIError,
  MessageFlags,
  ModalBuilder,
  RESTJSONErrorCodes,
  TextInputBuilder,
  TextInputStyle,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
  type User,
} from "discord.js";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createPlayer, type Player } from "../../game/player";
import { ArtLibrary } from "../../render/art";
import { applyAction, currentView, ensureStory } from "../../story/engine";
import { GATE } from "../../story/prologue";
import type {
  StoryAction,
  StoryContext,
  StoryEvent,
  StoryView,
} from "../../story/types";
import { slash, type AppContext, type Command } from "../command";
import { tryRender } from "../images";
import { isBenignAckError, isBenignEditError } from "../interaction-errors";
import type { Logger } from "../../log/logger";
import { isOwner } from "../owner";
import {
  isPlainConversation,
  renderPlain,
  renderRich,
  type StoryMessage,
  type StoryScreen,
} from "../story-view";
import { launchStoryBattle } from "../story-battle";

// The story only ever shows/grants collectible cards (the starter book, name matching). It never
// resolves opponent-faction cards through this context, so it is wired to the Eyes-only pool.
export const storyContext = (ctx: AppContext): StoryContext => ({
  rng: ctx.rng,
  cards: ctx.collectibleCards,
  cardIndex: ctx.collectibleCardIndex,
});

/**
 * Just enough of a Discord DM channel for sending scene messages and showing the typing indicator.
 * `send` also carries battle-view payloads (content/embeds/components/files) when a story battle runs
 * in the DM, so its parameter is widened beyond StoryMessage.
 */
export interface DmChannel {
  send(payload: StoryMessage | object): Promise<{ id: string }>;
  sendTyping(): Promise<void>;
  /**
   * Strip the components (buttons) off a previously-sent message, leaving its text intact. Used to
   * disable the buttons on an older gate/scene before posting a new interactive one, so only ONE live
   * interaction point remains in the DM. Best-effort: a missing/too-old/gone message is swallowed.
   */
  clearComponents(messageId: string): Promise<void>;
  /**
   * Edit a previously-sent message in place to the given board payload. Used to animate the opponent's
   * opening enemy turn frame-by-frame on the DM board without re-sending. Best-effort: a benign edit
   * failure (message deleted / too old / gone) is swallowed so a dropped frame never breaks the launch.
   */
  edit(messageId: string, payload: object): Promise<void>;
  /**
   * Delete a previously-sent message by id. Used by the in-battle tutorial's board re-anchor (post a
   * fresh board, then delete the stale one). Best-effort: a benign "already gone" failure (message
   * deleted / too old / channel gone / no access) is swallowed so a double-delete never throws.
   */
  deleteMessage(messageId: string): Promise<void>;
}

/**
 * The raw discord.js channel we wrap: it exposes `messages.edit(id, payload)`. Both `user.createDM()`
 * and a component/modal interaction's `channel` are real DM channels that expose this.
 */
interface RawDmChannel {
  send(payload: StoryMessage | object): Promise<{ id: string }>;
  sendTyping(): Promise<void>;
  messages: {
    edit(messageId: string, payload: object): Promise<unknown>;
    delete(messageId: string): Promise<unknown>;
  };
  /** Present when the channel already implements the DmChannel seam directly (e.g. a test mock). */
  clearComponents?(messageId: string): Promise<void>;
  /** Present when the channel already implements the edit seam directly (e.g. a test mock). */
  edit?(messageId: string, payload: object): Promise<void>;
  /** Present when the channel already implements the delete seam directly (e.g. a test mock). */
  deleteMessage?(messageId: string): Promise<void>;
}

/**
 * Wraps a raw discord.js DM channel as a {@link DmChannel}, adding a best-effort `clearComponents`
 * that edits a previous message to `{ components: [] }`. A benign edit failure (message deleted / too
 * old / channel gone / no access) is logged and swallowed so stripping stale buttons never breaks the
 * send of the new scene; any other error is rethrown.
 */
function asDmChannel(raw: RawDmChannel, log: Logger): DmChannel {
  // When the raw channel already provides clearComponents (e.g. the test mock), use it as-is rather
  // than reaching for messages.edit, which it may not expose.
  const edit = raw.clearComponents
    ? (id: string) => raw.clearComponents!(id)
    : (id: string) => raw.messages.edit(id, { components: [] }).then(() => {});
  // Mirror the clearComponents mock-vs-raw split for a full board edit (opening animation frames).
  const rawEdit = raw.edit
    ? (id: string, payload: object) => raw.edit!(id, payload)
    : (id: string, payload: object) =>
        raw.messages.edit(id, payload).then(() => {});
  // Mirror the mock-vs-raw split for the re-anchor delete.
  const rawDelete = raw.deleteMessage
    ? (id: string) => raw.deleteMessage!(id)
    : (id: string) => raw.messages.delete(id).then(() => {});
  return {
    send: (payload) => raw.send(payload),
    sendTyping: () => raw.sendTyping(),
    async clearComponents(messageId: string): Promise<void> {
      try {
        await edit(messageId);
      } catch (error) {
        if (isBenignEditError(error)) {
          log.message("error", {
            messageId,
            error: `benign edit error swallowed while clearing stale buttons: ${
              (error as { code?: unknown }).code ?? "unknown"
            }`,
          });
          return;
        }
        throw error;
      }
    },
    async edit(messageId: string, payload: object): Promise<void> {
      try {
        await rawEdit(messageId, payload);
      } catch (error) {
        if (isBenignEditError(error)) {
          log.message("error", {
            messageId,
            error: `benign edit error swallowed while animating: ${
              (error as { code?: unknown }).code ?? "unknown"
            }`,
          });
          return;
        }
        throw error;
      }
    },
    async deleteMessage(messageId: string): Promise<void> {
      try {
        await rawDelete(messageId);
      } catch (error) {
        if (isBenignEditError(error)) {
          log.message("error", {
            messageId,
            error: `benign delete error swallowed while re-anchoring board: ${
              (error as { code?: unknown }).code ?? "unknown"
            }`,
          });
          return;
        }
        throw error;
      }
    },
  };
}

/**
 * The last interactive message id posted into a user's DM (gate or scene), keyed by userId. Process-
 * local: it lets a fresh gate clear the PREVIOUS gate's buttons even before `player.story` exists
 * (a brand-new player has no persisted `liveMessageId`). For scenes the persisted `liveMessageId` is
 * the durable record; this map mirrors it so one call site clears whichever currently holds buttons.
 */
const liveGateMessages = new Map<string, string>();

/** Test seam: clear the process-local live-message tracker so one test's ids don't leak into another. */
export function resetLiveGateMessages(): void {
  liveGateMessages.clear();
}

/**
 * The in-flight "Continue"-gate resolver for a user, keyed by userId. The in-battle tutorial callback
 * (story-battle.ts) sends a spoken beat with a single "Continue" button, then blocks on a Promise
 * stored here; pressing Continue (routed through `storyCommand.component` as `story:tut:continue`)
 * resolves it so the callback can re-anchor the board. Process-local; one in-flight wait per user is
 * enough because beats are strictly sequential (the battle awaits the whole callback before the next
 * beat). NO timeout — the wait holds until the press arrives.
 */
const tutorialContinueResolvers = new Map<string, () => void>();

/**
 * Register a Continue wait for a user and return a Promise that resolves when Continue is pressed.
 * Call this BEFORE awaiting the returned promise so a very fast press cannot arrive before the
 * resolver exists. If a resolver already exists for the user (a leaked/overlapping wait), resolve the
 * OLD one first so its parked callback unblocks and nothing leaks, then install the new resolver.
 */
export function registerTutorialContinue(userId: string): Promise<void> {
  const existing = tutorialContinueResolvers.get(userId);
  if (existing) {
    tutorialContinueResolvers.delete(userId);
    existing(); // unblock the stale parked callback so it cannot leak
  }
  return new Promise<void>((resolve) => {
    tutorialContinueResolvers.set(userId, resolve);
  });
}

/**
 * Resolve a user's in-flight Continue wait, if any. Returns true when a resolver was found and
 * called (deleting the entry); false when there was none — a stale/duplicate press, or a leftover
 * Continue button pressed after a resume with no beat parked — in which case the caller just acks and
 * no-ops.
 */
export function resolveTutorialContinue(userId: string): boolean {
  const resolve = tutorialContinueResolvers.get(userId);
  if (!resolve) return false;
  tutorialContinueResolvers.delete(userId);
  resolve();
  return true;
}

/** Test seam: clear the process-local Continue-resolver registry so one test's waits don't leak. */
export function resetTutorialContinue(): void {
  tutorialContinueResolvers.clear();
}

/**
 * The single-button row carried on the LAST bubble of a spoken tutorial beat: a plain "Continue" the
 * player presses to pull the board back. Label is EXACTLY "Continue" (player-facing UI stays plain,
 * no archaic tint). customId `story:tut:continue` routes through {@link storyCommand.component}.
 */
export function CONTINUE_ROW(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("story:tut:continue")
      .setLabel("Continue")
      .setStyle(ButtonStyle.Primary),
  );
}

/**
 * Edit whichever previously-posted interactive message still carries live buttons (the in-memory
 * gate/scene id, falling back to the persisted scene `liveMessageId`) to strip its components, so
 * posting a new gate/scene leaves only ONE live interaction point. Best-effort (the edit itself
 * swallows benign failures). The caller records the new id afterwards via {@link recordLive}.
 */
export async function clearLiveButtons(
  dm: DmChannel,
  userId: string,
  player: Player | null,
): Promise<void> {
  const id =
    liveGateMessages.get(userId) ?? player?.story?.liveMessageId ?? null;
  if (id) await dm.clearComponents(id);
}

/**
 * Record the id of the message that now holds the live buttons for this user: always in the in-memory
 * tracker, and (when the player has a story) in the persisted `liveMessageId` stale-button guard.
 */
export function recordLive(
  userId: string,
  messageId: string,
  player: Player | null = null,
): void {
  liveGateMessages.set(userId, messageId);
  if (player?.story) player.story.liveMessageId = messageId;
}

/** Tunable pacing for the story's "typing one line at a time" effect. */
const TYPING_MS_PER_CHAR = 30;
const TYPING_MIN_MS = 800;
const TYPING_MAX_MS = 4000;

/** How long to show the typing indicator before a message, proportional to its length (clamped). */
function typingDelay(text: string): number {
  return Math.min(
    Math.max(text.length * TYPING_MS_PER_CHAR, TYPING_MIN_MS),
    TYPING_MAX_MS,
  );
}

/** How long to wait, behind a seam so tests can inject a recording no-op instead of a real timer. */
export type Sleep = (ms: number) => Promise<void>;
const defaultSleep: Sleep = (ms) => new Promise<void>((r) => setTimeout(r, ms));
let sleep: Sleep = defaultSleep;

/** Test seam: replace the pacing sleep (e.g. with a recording no-op). Call with no args to reset. */
export function setStorySleep(replacement: Sleep = defaultSleep): void {
  sleep = replacement;
}

/**
 * Wait the story "typing" pause proportional to a line's length, behind the SAME `sleep` seam the
 * scene delivery uses — so a test that calls `setStorySleep(async () => {})` silences the in-battle
 * tutorial pacing too. Exported for the tutorial callback in story-battle.ts to reuse.
 */
export function storyTypingPause(text: string): Promise<void> {
  return sleep(typingDelay(text));
}

/** The text a plain message carries, used to size its typing delay. */
function messageText(msg: StoryMessage): string {
  return "content" in msg ? msg.content : "";
}

function logEvents(
  ctx: AppContext,
  user: { id: string; username: string },
  events: readonly StoryEvent[],
): void {
  for (const event of events)
    ctx.log.game("story_event", {
      userId: user.id,
      username: user.username,
      ...event,
    });
}

/** Builds the StoryScreen for the scene the player is in: text, buttons and (for maps and the book) an image. */
async function screenFor(
  ctx: AppContext,
  player: Player,
): Promise<StoryScreen> {
  const view = currentView(player, storyContext(ctx));
  const story = player.story!;
  const image = await imageFor(ctx, view);
  const footer = view.pack
    ? `Opened ${story.pack!.rerolls + 1} time${story.pack!.rerolls === 0 ? "" : "s"}`
    : (story.name ?? undefined);
  return { nodeId: story.node, view, image: image ?? undefined, footer };
}

async function imageFor(
  ctx: AppContext,
  view: StoryView,
): Promise<Buffer | null> {
  if (view.map) return tryRender(ctx, (r) => r.map(view.map!));
  if (view.pack) return tryRender(ctx, (r) => r.pack(view.pack!.cards));
  if (view.portrait) return loadPortrait(view.portrait.assetKey);
  return null;
}

// Portrait assets (the inside man etc.) live in assets/portraits; mtime-cached, downscaled to 640.
const portraitLib = new ArtLibrary(
  join(fileURLToPath(new URL("../../../assets", import.meta.url)), "portraits"),
);

/** Loads a portrait asset and returns it as a PNG buffer for the embed image, or null when missing. */
async function loadPortrait(assetKey: string): Promise<Buffer | null> {
  const canvas = await portraitLib.get(assetKey);
  return canvas ? canvas.toBuffer("image/png") : null;
}

/**
 * Sends the current scene to the player's DM as fresh message(s). A conversation scene is split one
 * message per line with the buttons on the last; a map/book scene is a single embed. The id of the
 * message that carries the live buttons is stored on the player so stale buttons can be detected.
 */
export async function deliverScene(
  ctx: AppContext,
  user: { id: string; username: string },
  player: Player,
  dm: DmChannel,
  avatarUrl: string | null = null,
): Promise<void> {
  const screen = await screenFor(ctx, player);
  // Strip the buttons off whatever interactive message is currently live in this DM (the prior scene
  // or a still-open gate) BEFORE posting the new scene, so only one live interaction point remains.
  await clearLiveButtons(dm, user.id, player);
  // BATTLE branch first: a battle node renders no story text; hand off to the launcher/resumer, which
  // sends the battle message and records the new live id itself.
  if (screen.view.battle) {
    await launchStoryBattle(ctx, user, player, dm, avatarUrl);
    return;
  }
  let liveId: string;
  if (isPlainConversation(screen.view)) {
    const msgs = renderPlain(screen);
    let last = { id: "" };
    // Pace each line: show typing, wait proportional to its length, then send. Buttons ride the last.
    for (const msg of msgs) {
      const extra = "pauseBeforeMs" in msg ? (msg.pauseBeforeMs ?? 0) : 0;
      await dm.sendTyping();
      await sleep(typingDelay(messageText(msg)) + extra);
      last = await dm.send(msg);
    }
    liveId = last.id;
  } else {
    // A rich (map/book) scene is a single embed: one short typing beat, then the one send.
    await dm.sendTyping();
    const sent = await dm.send(renderRich(screen));
    liveId = sent.id;
  }
  recordLive(user.id, liveId, player);
  await ctx.repo.save(player);
}

/** The single source of the gate's two-button row: yes (primary), decline (secondary). */
export function gateComponents(
  yesLabel: string,
  yesId: string, // "story:gate:begin" | "story:gate:resume"
  noLabel: string,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(yesId)
      .setLabel(yesLabel)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("story:gate:decline")
      .setLabel(noLabel)
      .setStyle(ButtonStyle.Secondary),
  );
}

/** The gate shown before the story: either the ready-gate (no progress) or a resume gate. */
export function gateMessage(
  line: string,
  yesLabel: string,
  yesId: string,
  noLabel: string,
): StoryMessage {
  return {
    content: line,
    components: [gateComponents(yesLabel, yesId, noLabel)],
    allowedMentions: { parse: [] },
  };
}

/** The begin-vs-resume gate line/labels/id for the live player, as an object (callers destructure). */
function buildGate(player: Player): {
  line: string;
  yesLabel: string;
  yesId: string;
  noLabel: string;
} {
  return player.story
    ? {
        line: GATE.resumeLine,
        yesLabel: GATE.resumeYes,
        yesId: "story:gate:resume",
        noLabel: GATE.resumeNo,
      }
    : {
        line: GATE.readyLine,
        yesLabel: GATE.readyYes,
        yesId: "story:gate:begin",
        noLabel: GATE.readyNo,
      };
}

/** Opens the user's DM channel, mapping a closed-DM refusal to null (reusing the dm.ts error pattern). */
export async function resolveDm(
  user: User,
  log: Logger,
): Promise<DmChannel | null> {
  try {
    return asDmChannel((await user.createDM()) as unknown as RawDmChannel, log);
  } catch (error) {
    if (
      error instanceof DiscordAPIError &&
      error.code === RESTJSONErrorCodes.CannotSendMessagesToThisUser
    )
      return null;
    throw error;
  }
}

const CLOSED_DM =
  "❌ I couldn't reach you. Open your DMs (Privacy Settings → allow DMs from server members) and try again.";
const DM_POINTER = "📬 Check your DMs — we'll talk there.";

function nameModal(nodeId: string, view: StoryView): ModalBuilder {
  const input = view.input!;
  return new ModalBuilder()
    .setCustomId(`story:${nodeId}:text`)
    .setTitle(input.modalTitle)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("text")
          .setLabel(input.label)
          .setPlaceholder(input.placeholder)
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(40)
          .setRequired(true),
      ),
    );
}

export const storyCommand: Command = {
  data: slash(
    "story",
    "Begin the story, or continue where you left off",
  ).addBooleanOption((option) =>
    option
      .setName("restart")
      .setDescription("Owner only: erase all your progress and start over"),
  ),

  async execute(interaction, ctx) {
    const user = interaction.user;
    // Defer immediately: opening the DM channel and sending the gate are network calls that can
    // exceed Discord's 3-second window for the first response. Deferring reserves the token (15 min)
    // so the final editReply below never fails with 10062 Unknown interaction.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const reply = (content: string) => interaction.editReply({ content });

    if (interaction.options.getBoolean("restart")) {
      if (!(await isOwner(interaction.client, user.id))) {
        await reply("Only the bot owner may begin the tale anew.");
        return;
      }
      await ctx.repo.save(createPlayer(user.id));
      ctx.log.game("story_restarted", {
        userId: user.id,
        username: user.username,
      });
    }

    const dm = await resolveDm(user, ctx.log);
    if (!dm) {
      await reply(CLOSED_DM);
      return;
    }

    // The ready/resume gate is a command-layer pre-scene: declining it persists nothing.
    const player = ctx.repo.get(user.id);
    const g = buildGate(player);
    // A prior /story may have left a gate or scene with live buttons; strip them before the new gate
    // so a repeated /story never stacks duplicate live-button messages in the DM.
    await clearLiveButtons(dm, user.id, player);
    const sentGate = await dm.send(
      gateMessage(g.line, g.yesLabel, g.yesId, g.noLabel),
    );
    recordLive(user.id, sentGate.id);
    await reply(DM_POINTER);
  },

  async component(interaction, ctx) {
    if (!interaction.isButton()) return;
    const [, nodeId, kind, arg] = interaction.customId.split(":");
    const user = interaction.user;

    // The gate buttons (story:gate:*) are handled before any scene logic.
    if (nodeId === "gate") {
      await handleGate(interaction, ctx, kind);
      return;
    }

    // The in-battle tutorial "Continue" gate (story:tut:continue). Handled BEFORE the player.story
    // null-check and the stale guard: a Continue press is not tied to a story node, so the
    // node/liveMessageId staleness logic must not run on it. Resolve the parked beat (if any), then
    // ack by stripping the button off this message. A press with no parked resolver (stale/duplicate,
    // or a leftover Continue pressed after a resume) is a benign no-op: still ack + strip, do nothing.
    if (nodeId === "tut" && kind === "continue") {
      resolveTutorialContinue(user.id);
      try {
        await interaction.update({ components: [] });
      } catch (error) {
        if (isBenignAckError(error)) {
          ctx.log.message("error", {
            userId: user.id,
            error: `benign ack error swallowed on Continue press: ${
              (error as { code?: unknown }).code ?? "unknown"
            }`,
          });
          return;
        }
        throw error;
      }
      return;
    }

    const player = ctx.repo.get(user.id);
    if (!player.story) {
      await interaction.update({
        content: "Speak `/story` to begin.",
        embeds: [],
        components: [],
        attachments: [],
      });
      return;
    }

    // A stale message (an earlier scene, or a message whose scene has advanced) does nothing but
    // strip its own buttons — it must not advance or repeat the story.
    const pressedId = interaction.message?.id;
    const stale =
      (player.story.liveMessageId !== null &&
        pressedId !== player.story.liveMessageId) ||
      player.story.node !== nodeId;
    if (stale) {
      await interaction.update({ components: [] });
      return;
    }

    if (kind === "input") {
      const view = currentView(player, storyContext(ctx));
      if (view.input) await interaction.showModal(nameModal(nodeId, view));
      return;
    }
    if (kind !== "c") return;

    const result = applyAction(
      player,
      nodeId,
      { type: "choice", index: Number(arg) },
      storyContext(ctx),
    );
    if (!result.ok) {
      await interaction.update({ components: [] });
      return;
    }
    logEvents(ctx, user, result.events);
    // Claim the advance BEFORE the slow paced send: persist the new node now (liveMessageId is still
    // the OLD message id — recordLive advances it only after the send) so a redelivered/concurrent
    // handling of this same press reads the advanced node and applyAction's `node !== nodeId` check
    // short-circuits it. This closes the window where the old node stayed readable during delivery.
    await ctx.repo.save(player);
    // Kill the pressed message's buttons, then send the next scene as fresh DM message(s). The avatar
    // URL is threaded so a transition into cave_battle (agree / coercion / retry) renders the player.
    await interaction.update({ components: [] });
    await deliverScene(
      ctx,
      user,
      player,
      dmFrom(interaction, ctx.log),
      avatarUrlOf(interaction),
    );
  },

  async modal(interaction, ctx) {
    const [, nodeId, kind] = interaction.customId.split(":");
    if (kind !== "text") return;
    const user = interaction.user;
    const player = ctx.repo.get(user.id);

    // Resync (just re-send the current scene) if the player has moved on or has no story.
    if (!player.story || player.story.node !== nodeId) {
      if (interaction.isFromMessage())
        await interaction.update({ components: [] });
      if (player.story)
        await deliverScene(
          ctx,
          user,
          player,
          dmFrom(interaction, ctx.log),
          avatarUrlOf(interaction),
        );
      else
        await interaction.reply({
          content: "Speak `/story` to begin.",
          flags: MessageFlags.Ephemeral,
        });
      return;
    }

    const action: StoryAction = {
      type: "text",
      text: interaction.fields.getTextInputValue("text"),
    };
    const result = applyAction(player, nodeId, action, storyContext(ctx));
    if (result.ok) logEvents(ctx, user, result.events);

    // Claim the advance before the paced send (see the component path): persist the new node now so a
    // redelivered modal submit reads the advanced node and does not re-deliver. liveMessageId stays on
    // the old message until recordLive runs after the send, keeping the stale-button guard correct.
    await ctx.repo.save(player);
    // The form was opened from the live message; strip its buttons, then deliver the resulting scene
    // (which may still be ask_name with a notice when the name was rejected).
    if (interaction.isFromMessage())
      await interaction.update({ components: [] });
    await deliverScene(
      ctx,
      user,
      player,
      dmFrom(interaction, ctx.log),
      avatarUrlOf(interaction),
    );
  },
};

/** The DM channel a button/modal was sent on. Replies go back to the same DM. */
function dmFrom(
  interaction: MessageComponentInteraction | ModalSubmitInteraction,
  log: Logger,
): DmChannel {
  return asDmChannel(interaction.channel as unknown as RawDmChannel, log);
}

/** The interaction user's avatar URL, or null when it is unavailable (e.g. a bare test user). */
function avatarUrlOf(
  interaction: MessageComponentInteraction | ModalSubmitInteraction,
): string | null {
  const user = interaction.user as {
    displayAvatarURL?: (opts?: unknown) => string;
  };
  return typeof user.displayAvatarURL === "function"
    ? user.displayAvatarURL({ extension: "png", size: 128 })
    : null;
}

/** Handles the ready/resume gate. begin/resume re-derive from live progress; decline persists nothing. */
async function handleGate(
  interaction: MessageComponentInteraction,
  ctx: AppContext,
  kind: string,
): Promise<void> {
  const user = interaction.user;

  // Stale/idempotency guard: a gate is live only while it is the last interactive message posted into
  // the DM. If this press is on an older gate (a prior /story's gate that a newer gate/scene already
  // superseded), just strip its own buttons and return — do NOT re-run ensureStory/deliverScene, which
  // would re-deliver the whole greeting. For a brand-new player the live id lives only in the in-memory
  // tracker; for a player with progress it also lives in the persisted liveMessageId.
  const pressedId = interaction.message?.id;
  const liveId =
    liveGateMessages.get(user.id) ??
    ctx.repo.get(user.id).story?.liveMessageId ??
    null;
  if (liveId !== null && pressedId !== undefined && pressedId !== liveId) {
    await interaction.update({ components: [] });
    return;
  }

  // Disable the gate buttons first so it cannot be double-pressed.
  await interaction.update({ components: [] });

  if (kind === "decline") {
    const player = ctx.repo.get(user.id);
    // Decline persists NOTHING: a no-progress player keeps story === null; progress is left untouched.
    await dmFrom(interaction, ctx.log).send({
      content: player.story ? GATE.resumeDeclineLine : GATE.declineLine,
      allowedMentions: { parse: [] },
    });
    return;
  }

  // begin and resume both re-derive from the live player.story, so the action is correct even if the
  // gate's label was for the other case (e.g. an /invite began before the player made progress).
  const player = ctx.repo.get(user.id);
  const events = ensureStory(player, storyContext(ctx));
  if (events.length > 0) {
    await ctx.repo.save(player);
    logEvents(ctx, user, events);
  }
  // A resumed player may be sitting on cave_battle, so thread the resumer's avatar for the duel render.
  await deliverScene(
    ctx,
    user,
    player,
    dmFrom(interaction, ctx.log),
    avatarUrlOf(interaction),
  );
}

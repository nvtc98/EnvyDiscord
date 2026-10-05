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
import { createPlayer, type Player } from "../../game/player";
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
import { isOwner } from "../owner";
import {
  isPlainConversation,
  renderPlain,
  renderRich,
  type StoryMessage,
  type StoryScreen,
} from "../story-view";

const storyContext = (ctx: AppContext): StoryContext => ({
  rng: ctx.rng,
  cards: ctx.cards,
  cardIndex: ctx.cardIndex,
});

/** Just enough of a Discord DM channel for sending scene messages. */
interface DmChannel {
  send(payload: StoryMessage): Promise<{ id: string }>;
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
  return null;
}

/**
 * Sends the current scene to the player's DM as fresh message(s). A conversation scene is split one
 * message per line with the buttons on the last; a map/book scene is a single embed. The id of the
 * message that carries the live buttons is stored on the player so stale buttons can be detected.
 */
async function deliverScene(
  ctx: AppContext,
  user: { id: string; username: string },
  player: Player,
  dm: DmChannel,
): Promise<void> {
  const screen = await screenFor(ctx, player);
  let liveId: string;
  if (isPlainConversation(screen.view)) {
    const msgs = renderPlain(screen);
    let last = { id: "" };
    for (const msg of msgs) last = await dm.send(msg);
    liveId = last.id;
  } else {
    const sent = await dm.send(renderRich(screen));
    liveId = sent.id;
  }
  player.story!.liveMessageId = liveId;
  await ctx.repo.save(player);
}

/** The gate shown before the story: either the ready-gate (no progress) or a resume gate. */
function gateMessage(
  line: string,
  yesLabel: string,
  yesId: string,
  noLabel: string,
): StoryMessage {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(yesId)
      .setLabel(yesLabel)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("story:gate:decline")
      .setLabel(noLabel)
      .setStyle(ButtonStyle.Secondary),
  );
  return { content: line, components: [row], allowedMentions: { parse: [] } };
}

/** Opens the user's DM channel, mapping a closed-DM refusal to null (reusing the dm.ts error pattern). */
async function resolveDm(user: User): Promise<DmChannel | null> {
  try {
    return (await user.createDM()) as unknown as DmChannel;
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
  "❌ I couldn't message you. Open your DMs (Privacy Settings → allow DMs from server members) and try again.";
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
      .setDescription("Owner only: erase all your progress and begin again"),
  ),

  async execute(interaction, ctx) {
    const user = interaction.user;
    const reply = (content: string) =>
      interaction.reply({ content, flags: MessageFlags.Ephemeral });

    if (interaction.options.getBoolean("restart")) {
      if (!(await isOwner(interaction.client, user.id))) {
        await reply("Only the bot owner can restart the story.");
        return;
      }
      await ctx.repo.save(createPlayer(user.id));
      ctx.log.game("story_restarted", {
        userId: user.id,
        username: user.username,
      });
    }

    const dm = await resolveDm(user);
    if (!dm) {
      await reply(CLOSED_DM);
      return;
    }

    // The ready/resume gate is a command-layer pre-scene: declining it persists nothing.
    const player = ctx.repo.get(user.id);
    const gate = player.story
      ? gateMessage(
          GATE.resumeLine,
          GATE.resumeYes,
          "story:gate:resume",
          GATE.resumeNo,
        )
      : gateMessage(
          GATE.readyLine,
          GATE.readyYes,
          "story:gate:begin",
          GATE.readyNo,
        );
    await dm.send(gate);
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

    const player = ctx.repo.get(user.id);
    if (!player.story) {
      await interaction.update({
        content: "Use `/story` to begin.",
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
    // Kill the pressed message's buttons, then send the next scene as fresh DM message(s).
    await interaction.update({ components: [] });
    await deliverScene(ctx, user, player, dmFrom(interaction));
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
        await deliverScene(ctx, user, player, dmFrom(interaction));
      else
        await interaction.reply({
          content: "Use `/story` to begin.",
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

    // The form was opened from the live message; strip its buttons, then deliver the resulting scene
    // (which may still be ask_name with a notice when the name was rejected).
    if (interaction.isFromMessage())
      await interaction.update({ components: [] });
    await deliverScene(ctx, user, player, dmFrom(interaction));
  },
};

/** The DM channel a button/modal was sent on. Replies go back to the same DM. */
function dmFrom(
  interaction: MessageComponentInteraction | ModalSubmitInteraction,
): DmChannel {
  return interaction.channel as unknown as DmChannel;
}

/** Handles the ready/resume gate. begin/resume re-derive from live progress; decline persists nothing. */
async function handleGate(
  interaction: MessageComponentInteraction,
  ctx: AppContext,
  kind: string,
): Promise<void> {
  const user = interaction.user;
  // Disable the gate buttons first so it cannot be double-pressed.
  await interaction.update({ components: [] });

  if (kind === "decline") {
    const player = ctx.repo.get(user.id);
    // Decline persists NOTHING: a no-progress player keeps story === null; progress is left untouched.
    await dmFrom(interaction).send({
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
  await deliverScene(ctx, user, player, dmFrom(interaction));
}

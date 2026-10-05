import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { EMBED_COLOR } from "../render/theme";
import type { CardDef } from "../engine/types";
import type {
  MapView,
  StoryChoice,
  StoryLine,
  StoryView,
} from "../story/types";
import { attach } from "./images";

export interface StoryScreen {
  nodeId: string;
  view: StoryView;
  /** The map or card grid image. When absent a text version is shown instead. */
  image?: Buffer;
  footer?: string;
}

/** One Discord message payload for a scene: a plain conversation line, or a rich (embed) scene. */
export type StoryMessage =
  | {
      content: string;
      components?: ActionRowBuilder<ButtonBuilder>[];
      files?: AttachmentBuilder[];
      allowedMentions: { parse: [] };
    }
  | {
      embeds: EmbedBuilder[];
      components?: ActionRowBuilder<ButtonBuilder>[];
      files?: AttachmentBuilder[];
      allowedMentions: { parse: [] };
    };

/**
 * A conversation scene renders as plain text (one message per line); a scene with a map or a card
 * pack keeps the embed box so those features show in full.
 */
export function isPlainConversation(view: StoryView): boolean {
  return !view.map && !view.pack;
}

const STYLES: Record<NonNullable<StoryChoice["style"]>, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

function formatPlain(line: StoryLine): string {
  // A single stranger speaks throughout the prologue, so his name is never printed:
  // a spoken line (with a speaker) renders as plain text, a gesture/narration line stays italic.
  return line.speaker ? line.text : `*${line.text}*`;
}

/** A text drawing of the map, used when images are unavailable. */
function mapText(map: MapView): string {
  const ordered = [...map.locations].sort((a, b) => a.x - b.x);
  return ordered
    .map((l) => (l.here ? `● ${l.name} (you are here)` : `○ ${l.name}`))
    .join("  ──  ");
}

function packText(cards: CardDef[]): string {
  return cards
    .map(
      (c) =>
        `• **${c.name}** (${c.rarity ?? "common"} · cost ${c.cost} · power ${c.power})`,
    )
    .join("\n");
}

/** The action row for a scene's buttons (input button first, then choices). Null when there are none. */
function buttonRow(
  screen: StoryScreen,
): ActionRowBuilder<ButtonBuilder> | null {
  const { view, nodeId } = screen;
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (view.input) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`story:${nodeId}:input`)
        .setLabel(view.input.buttonLabel)
        .setStyle(ButtonStyle.Primary),
    );
  }
  view.choices.forEach((choice, i) => {
    const button = new ButtonBuilder()
      .setCustomId(`story:${nodeId}:c:${i}`)
      .setLabel(choice.label)
      .setStyle(STYLES[choice.style ?? "secondary"]);
    if (choice.emoji) button.setEmoji(choice.emoji);
    row.addComponents(button);
  });
  return row.components.length > 0 ? row : null;
}

/**
 * A plain conversation scene: one text message per line, with the scene's buttons on the LAST
 * message only (the "typing one line at a time" effect). Never carries an image.
 */
export function renderPlain(screen: StoryScreen): StoryMessage[] {
  const { view } = screen;
  const row = buttonRow(screen);
  const lines = view.lines.length > 0 ? view.lines : [{ text: "\u200b" }];
  return lines.map((line, i) => {
    const last = i === lines.length - 1;
    const content = view.lines.length > 0 ? formatPlain(line) : "\u200b";
    return {
      content,
      components: last && row ? [row] : [],
      allowedMentions: { parse: [] },
    } satisfies StoryMessage;
  });
}

export function renderRich(screen: StoryScreen): StoryMessage {
  const { view, nodeId } = screen;
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR.story)
    .setTitle(view.title)
    .setDescription(view.lines.map(formatPlain).join("\n\n").slice(0, 3800));
  if (screen.footer) embed.setFooter({ text: screen.footer });

  if (!screen.image) {
    if (view.map) embed.addFields({ name: "Map", value: mapText(view.map) });
    if (view.pack)
      embed.addFields({
        name: "The cards",
        value: packText(view.pack.cards).slice(0, 1000),
      });
  }

  const row = buttonRow(screen);

  return {
    embeds: [embed],
    components: row ? [row] : [],
    files: screen.image
      ? [
          attach(
            screen.image,
            `story-${nodeId}-${screen.footer?.length ?? 0}-${Date.now()}.png`,
          ),
        ]
      : [],
    allowedMentions: { parse: [] },
  };
}

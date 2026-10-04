import {
  ActionRowBuilder,
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

const STYLES: Record<NonNullable<StoryChoice["style"]>, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

function formatLine(line: StoryLine): string {
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

export function renderStory(screen: StoryScreen) {
  const { view, nodeId } = screen;
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR.story)
    .setTitle(view.title)
    .setDescription(view.lines.map(formatLine).join("\n\n").slice(0, 3800));
  if (screen.footer) embed.setFooter({ text: screen.footer });

  if (!screen.image) {
    if (view.map) embed.addFields({ name: "Map", value: mapText(view.map) });
    if (view.pack)
      embed.addFields({
        name: "The cards",
        value: packText(view.pack.cards).slice(0, 1000),
      });
  }

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

  return {
    content: "",
    embeds: [embed],
    components: row.components.length > 0 ? [row] : [],
    files: screen.image
      ? [
          attach(
            screen.image,
            `story-${nodeId}-${screen.footer?.length ?? 0}-${Date.now()}.png`,
          ),
        ]
      : [],
  };
}

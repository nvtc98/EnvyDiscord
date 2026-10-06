import { EmbedBuilder } from "discord.js";
import { cardText } from "../engine/abilities";
import type { CardDef } from "../engine/types";
import { DEFAULT_VARIANT, getVariant, type VariantId } from "../data/variants";
import { EMBED_COLOR } from "../render/theme";

/** The display name of a variant, e.g. "Metal". Falls back to the raw id for an unknown variant. */
export const variantLabel = (id: VariantId): string =>
  getVariant(id)?.name ?? id;

/** One line describing a card: its cost, power and rules text. Used by text-mode replies and select menus. */
export function cardSummary(def: CardDef): string {
  const text = cardText(def);
  return `Cost ${def.cost} · Power ${def.power}${text ? ` · ${text}` : ""}`;
}

/** Text version of a card, used when images are unavailable. */
export function cardEmbed(
  def: CardDef,
  variant: VariantId = DEFAULT_VARIANT,
  footer?: string,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR.neutral)
    .setTitle(def.name)
    .setDescription(
      `**Cost ${def.cost}** · **Power ${def.power}**\n${cardText(def) || "No ability."}`,
    )
    .addFields({ name: "Frame", value: variantLabel(variant), inline: true });
  if (footer) embed.setFooter({ text: footer });
  return embed;
}

import { EmbedBuilder } from 'discord.js';
import { cardText } from '../engine/abilities';
import type { CardDef } from '../engine/types';
import { MAX_TIER } from '../game/player';
import { EMBED_COLOR } from '../render/theme';

export const tierLabel = (tier: number): string => `Frame tier ${tier}/${MAX_TIER}`;

/** One line describing a card: its cost, power and rules text. Used by text-mode replies and select menus. */
export function cardSummary(def: CardDef): string {
  const text = cardText(def);
  return `Cost ${def.cost} · Power ${def.power}${text ? ` · ${text}` : ''}`;
}

/** Text version of a card, used when images are unavailable. */
export function cardEmbed(def: CardDef, tier = 1, footer?: string): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR.neutral)
    .setTitle(def.name)
    .setDescription(`**Cost ${def.cost}** · **Power ${def.power}**\n${cardText(def) || 'No ability.'}`)
    .addFields({ name: 'Frame', value: tierLabel(tier), inline: true });
  if (footer) embed.setFooter({ text: footer });
  return embed;
}

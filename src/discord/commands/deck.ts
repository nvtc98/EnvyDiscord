import { ActionRowBuilder, MessageFlags, StringSelectMenuBuilder } from 'discord.js';
import { DECK_SIZE } from '../../engine/types';
import { ownedCards, resolveDeck } from '../../game/deck';
import { slash, type Command } from '../command';
import { cardSummary } from '../render';

export const deckCommand: Command = {
  data: slash('deck', `Choose the ${DECK_SIZE} cards you take into battle`),

  async execute(interaction, ctx) {
    const player = ctx.repo.get(interaction.user.id);
    const owned = ownedCards(player, ctx.cardIndex);
    if (owned.length < DECK_SIZE) {
      await interaction.reply({
        content: `You own ${owned.length} different card${owned.length === 1 ? '' : 's'} and a deck needs ${DECK_SIZE}. Until then, battles fill the empty slots with guest cards that are not added to your collection. Use \`/daily\` to collect more.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const current = new Set(resolveDeck(player, ctx.cards, ctx.cardIndex, ctx.rng).cards.map((c) => c.id));
    const menu = new StringSelectMenuBuilder()
      .setCustomId('deck:select')
      .setPlaceholder(`Pick exactly ${DECK_SIZE} cards`)
      .setMinValues(DECK_SIZE)
      .setMaxValues(DECK_SIZE)
      .addOptions(
        owned.slice(0, 25).map(({ def }) => ({
          label: def.name,
          description: cardSummary(def).slice(0, 100),
          value: def.id,
          default: current.has(def.id),
        })),
      );
    const shown = Math.min(owned.length, 25);
    await interaction.reply({
      content: `Choose your ${DECK_SIZE}-card deck:${owned.length > shown ? ` (showing your ${shown} cheapest of ${owned.length} cards; browsing the rest is coming)` : ''}`,
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
      flags: MessageFlags.Ephemeral,
    });
  },

  async component(interaction, ctx) {
    if (!interaction.isStringSelectMenu()) return;
    const player = ctx.repo.get(interaction.user.id);
    const chosen = [...new Set(interaction.values)].filter((id) => player.cards[id] !== undefined && ctx.cardIndex.has(id));
    if (chosen.length !== DECK_SIZE) {
      await interaction.update({ content: 'Invalid selection, run `/deck` again.', components: [] });
      return;
    }
    player.deck = chosen;
    await ctx.repo.save(player);
    ctx.log.game('deck_set', { userId: interaction.user.id, username: interaction.user.username, deck: chosen });
    await interaction.update({ content: `✅ Deck saved: ${chosen.map((id) => ctx.cardIndex.get(id)!.name).join(' · ')}`, components: [] });
  },
};

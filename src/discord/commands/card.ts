import { MessageFlags } from 'discord.js';
import { normalize } from '../../util/text';
import { slash, type Command } from '../command';
import { attach, tryRender } from '../images';
import { cardEmbed } from '../render';

export const cardCommand: Command = {
  data: slash('card', 'View the details of a card').addStringOption((option) =>
    option.setName('name').setDescription('Card name').setRequired(true).setAutocomplete(true),
  ),

  async autocomplete(interaction, ctx) {
    const query = normalize(interaction.options.getFocused());
    const choices = ctx.cards
      .filter((c) => normalize(c.name).includes(query))
      .slice(0, 25)
      .map((c) => ({ name: `${c.name} · cost ${c.cost}, power ${c.power}`, value: c.id }));
    await interaction.respond(choices);
  },

  async execute(interaction, ctx) {
    const input = interaction.options.getString('name', true);
    const wanted = normalize(input);
    const def = ctx.cardIndex.get(input) ?? ctx.cards.find((c) => normalize(c.name) === wanted);
    if (!def) {
      await interaction.reply({ content: `Card "${input}" not found.`, flags: MessageFlags.Ephemeral });
      return;
    }
    const tier = ctx.repo.get(interaction.user.id).cards[def.id];
    const note = tier ? `You own this card: frame tier ${tier}` : "You don't own this card yet";

    const image = await tryRender(ctx, (r) => r.cards([{ def, tier: tier ?? 1 }], { scale: 2 }));
    if (image) {
      await interaction.reply({ content: `**${def.name}** · ${note}`, files: [attach(image, `${def.id}.png`)] });
      return;
    }
    await interaction.reply({ embeds: [cardEmbed(def, tier ?? 1, note)] });
  },
};

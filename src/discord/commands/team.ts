import { ActionRowBuilder, MessageFlags, StringSelectMenuBuilder } from 'discord.js';
import { TEAM_SIZE, ownedCards, resolveTeam } from '../../game/team';
import { slash, type Command } from '../command';
import { ELEMENT_EMOJI, RARITY_LABEL } from '../render';

export const teamCommand: Command = {
  data: slash('team', `Choose ${TEAM_SIZE} cards for your battle team`),

  async execute(interaction, ctx) {
    const player = ctx.repo.get(interaction.user.id);
    const owned = ownedCards(player, ctx.cardIndex);
    if (owned.length < TEAM_SIZE) {
      await interaction.reply({
        content: `You need at least ${TEAM_SIZE} different cards. Use \`/daily\` to get some!`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const current = new Set((resolveTeam(player, ctx.cardIndex) ?? []).map((m) => m.def.id));
    const menu = new StringSelectMenuBuilder()
      .setCustomId('team:select')
      .setPlaceholder(`Pick exactly ${TEAM_SIZE} cards`)
      .setMinValues(TEAM_SIZE)
      .setMaxValues(TEAM_SIZE)
      .addOptions(
        owned.slice(0, 25).map(({ def, level }) => ({
          label: def.name,
          description: `${RARITY_LABEL[def.rarity]} · Lv ${level}`,
          value: def.id,
          emoji: ELEMENT_EMOJI[def.element],
          default: current.has(def.id),
        })),
      );
    await interaction.reply({
      content: 'Choose your team:',
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
      flags: MessageFlags.Ephemeral,
    });
  },

  async component(interaction, ctx) {
    if (!interaction.isStringSelectMenu()) return;
    const player = ctx.repo.get(interaction.user.id);
    const chosen = [...new Set(interaction.values)].filter((id) => player.cards[id] !== undefined);
    if (chosen.length !== TEAM_SIZE) {
      await interaction.update({ content: 'Invalid selection, run `/team` again.', components: [] });
      return;
    }
    player.team = chosen;
    await ctx.repo.save(player);
    const names = chosen.map((id) => `${ELEMENT_EMOJI[ctx.cardIndex.get(id)!.element]} ${ctx.cardIndex.get(id)!.name}`);
    await interaction.update({ content: `✅ New team: ${names.join(' · ')}`, components: [] });
  },
};

import { EmbedBuilder, MessageFlags } from 'discord.js';
import { todayKey } from '../../game/gacha';
import { EMBED_COLOR } from '../../render/theme';
import { slash, type Command } from '../command';

export const profileCommand: Command = {
  data: slash('profile', 'View your stats'),

  async execute(interaction, ctx) {
    const player = ctx.repo.get(interaction.user.id);
    const games = player.wins + player.losses;
    const rate = games > 0 ? `${Math.round((player.wins / games) * 100)}%` : '—';
    const claimed = player.lastDaily === todayKey(new Date(), ctx.timezone);

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR.profile)
      .setTitle(`👤 ${interaction.user.displayName}`)
      .addFields(
        { name: '💰 Coins', value: String(player.coins), inline: true },
        { name: '🏆 Wins / Losses', value: `${player.wins} / ${player.losses} (${rate})`, inline: true },
        { name: '🎴 Cards', value: `${Object.keys(player.cards).length}/${ctx.cards.length}`, inline: true },
        { name: '🎁 Daily pack today', value: claimed ? 'Claimed' : 'Not claimed', inline: true },
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

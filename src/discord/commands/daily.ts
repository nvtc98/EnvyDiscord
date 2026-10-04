import { EmbedBuilder, MessageFlags } from 'discord.js';
import { claimDaily, todayKey } from '../../game/gacha';
import type { GrantResult } from '../../game/player';
import { EMBED_COLOR } from '../../render/theme';
import { slash, type Command } from '../command';
import { attach, tryRender } from '../images';
import { cardSummary } from '../render';

function describeGrant(grant: GrantResult): string {
  return grant.kind === 'new'
    ? `🆕 **${grant.card.name}** · ${cardSummary(grant.card)}`
    : `⬆️ **${grant.card.name}** reached frame tier **${grant.tier}**`;
}

export const dailyCommand: Command = {
  data: slash('daily', 'Claim your free daily card pack'),

  async execute(interaction, ctx) {
    const player = ctx.repo.get(interaction.user.id);
    const result = claimDaily(player, ctx.cards, todayKey(new Date(), ctx.timezone), ctx.rng);
    if (!result.ok) {
      const content =
        result.reason === 'already-claimed'
          ? '⏳ You already claimed your pack today. Come back tomorrow!'
          : '🏆 Your collection is complete: every card has reached its maximum frame tier, so there is nothing left to receive.';
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      return;
    }
    await ctx.repo.save(player);
    ctx.log.game('daily_claimed', {
      userId: interaction.user.id,
      username: interaction.user.username,
      grants: result.grants.map((g) => ({ card: g.card.id, result: g.kind, tier: g.tier })),
      coinsAwarded: result.coins,
      coinsTotal: player.coins,
    });

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR.daily)
      .setTitle('🎁 Daily pack')
      .setDescription(result.grants.map(describeGrant).join('\n'))
      .setFooter({ text: `+${result.coins} coins · Total: ${player.coins} coins` });

    const image = await tryRender(ctx, (r) =>
      r.cards(result.grants.map((g) => ({ def: g.card, tier: g.tier, badge: g.kind === 'new' ? 'NEW' : `TIER ${g.tier}` }))),
    );
    await interaction.reply({ embeds: [embed], files: image ? [attach(image, 'daily.png')] : [] });
  },
};

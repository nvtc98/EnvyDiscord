import { EmbedBuilder, MessageFlags } from 'discord.js';
import { claimDaily, todayKey } from '../../game/gacha';
import type { GrantResult } from '../../game/player';
import { slash, type Command } from '../command';
import { attach, tryRender } from '../images';
import { ELEMENT_EMOJI, RARITY_LABEL } from '../render';

function describeGrant(grant: GrantResult): string {
  const name = `${ELEMENT_EMOJI[grant.card.element]} **${grant.card.name}** (${RARITY_LABEL[grant.card.rarity]})`;
  switch (grant.kind) {
    case 'new':
      return `🆕 ${name}`;
    case 'levelup':
      return `⬆️ ${name} reached **Lv ${grant.level}**`;
    case 'maxed':
      return `💰 ${name} is already max level, converted to **${grant.coins} coins**`;
  }
}

export const dailyCommand: Command = {
  data: slash('daily', 'Claim your free daily card pack'),

  async execute(interaction, ctx) {
    const player = ctx.repo.get(interaction.user.id);
    const result = claimDaily(player, ctx.cards, todayKey(new Date(), ctx.timezone), ctx.rng);
    if (!result.ok) {
      await interaction.reply({ content: '⏳ You already claimed your pack today. Come back tomorrow!', flags: MessageFlags.Ephemeral });
      return;
    }
    await ctx.repo.save(player);

    const embed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle('🎁 Daily pack')
      .setDescription(result.grants.map(describeGrant).join('\n'))
      .setFooter({ text: `+${result.coins} coins · Total: ${player.coins} coins` });

    const image = await tryRender(ctx, (r) =>
      r.cards(
        result.grants.map((g) => ({
          def: g.card,
          level: g.level,
          badge: g.kind === 'new' ? 'NEW' : g.kind === 'levelup' ? `LV ${g.level}` : 'MAX',
        })),
        { scale: 0.9 },
      ),
    );
    await interaction.reply({ embeds: [embed], files: image ? [attach(image, 'daily.png')] : [] });
  },
};

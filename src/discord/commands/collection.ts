import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { ownedCards } from '../../game/deck';
import { MAX_TIER, type Player } from '../../game/player';
import { EMBED_COLOR } from '../../render/theme';
import { slash, type AppContext, type Command } from '../command';
import { attach, tryRender } from '../images';
import { cardSummary, tierLabel } from '../render';

// Three cards per page: that is what fits legibly in one row of the image.
const PAGE_SIZE = 3;

async function view(player: Player, ctx: AppContext, requestedPage: number) {
  const items = ownedCards(player, ctx.cardIndex);
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const page = Math.min(Math.max(0, requestedPage), pages - 1);
  const maxed = items.filter((o) => o.tier >= MAX_TIER).length;

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR.neutral)
    .setTitle('🎴 Collection')
    .setFooter({ text: `Page ${page + 1}/${pages} · Owned ${items.length}/${ctx.cards.length} cards · ${maxed} at max tier` });
  if (items.length === 0) embed.setDescription('No cards yet. Use `/daily` to get your first cards!');

  const slice = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const image = slice.length > 0 ? await tryRender(ctx, (r) => r.cards(slice.map(({ def, tier }) => ({ def, tier, badge: `TIER ${tier}` })))) : null;
  if (!image) {
    for (const { def, tier } of slice) embed.addFields({ name: `${def.name} · ${tierLabel(tier)}`, value: cardSummary(def) });
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`collection:${page - 1}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`collection:${page + 1}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1),
  );
  return { embeds: [embed], components: [row], files: image ? [attach(image, `collection-${page}.png`)] : [] };
}

export const collectionCommand: Command = {
  data: slash('collection', 'View your card collection'),

  async execute(interaction, ctx) {
    const player = ctx.repo.get(interaction.user.id);
    await interaction.reply({ ...(await view(player, ctx, 0)), flags: MessageFlags.Ephemeral });
  },

  async component(interaction, ctx) {
    if (!interaction.isButton()) return;
    const page = Number(interaction.customId.split(':')[1]);
    const player = ctx.repo.get(interaction.user.id);
    // `attachments: []` drops the previous page's image so only the new one stays.
    await interaction.update({ ...(await view(player, ctx, Number.isFinite(page) ? page : 0)), attachments: [] });
  },
};

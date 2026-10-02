import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { createFighter } from '../../engine/fighter';
import type { Player } from '../../game/player';
import { ownedCards } from '../../game/team';
import { slash, type AppContext, type Command } from '../command';
import { attach, tryRender } from '../images';
import { ELEMENT_EMOJI, RARITY_LABEL, statsLine } from '../render';

// Three cards per page: that is what fits legibly in one row of the image.
const PAGE_SIZE = 3;

async function view(player: Player, ctx: AppContext, requestedPage: number) {
  const items = ownedCards(player, ctx.cardIndex);
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const page = Math.min(Math.max(0, requestedPage), pages - 1);

  const embed = new EmbedBuilder()
    .setColor(0x6366f1)
    .setTitle('🎴 Collection')
    .setFooter({ text: `Page ${page + 1}/${pages} · Owned ${items.length}/${ctx.cards.length} cards` });
  if (items.length === 0) embed.setDescription('No cards yet. Use `/daily` to get your first cards!');
  const slice = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const image =
    slice.length > 0 ? await tryRender(ctx, (r) => r.cards(slice.map(({ def, level }) => ({ def, level })), { scale: 0.9 })) : null;
  if (!image) {
    for (const { def, level } of slice) {
      embed.addFields({
        name: `${ELEMENT_EMOJI[def.element]} ${def.name} · Lv ${level}`,
        value: `${RARITY_LABEL[def.rarity]}\n${statsLine(createFighter(def, level))}`,
      });
    }
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

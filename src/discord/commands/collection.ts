import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { ownedCards } from "../../game/deck";
import { hasPlayed, type Player } from "../../game/player";
import { EMBED_COLOR } from "../../render/theme";
import { slash, type AppContext, type Command } from "../command";
import { attach, tryRender } from "../images";
import { cardSummary } from "../render";

// Three cards per page: that is what fits legibly in one row of the image.
const PAGE_SIZE = 3;

async function view(
  player: Player,
  ctx: AppContext,
  requestedPage: number,
  targetId?: string,
) {
  const items = ownedCards(player, ctx.cardIndex);
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const page = Math.min(Math.max(0, requestedPage), pages - 1);
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR.neutral)
    .setTitle("🎴 Your collection")
    .setFooter({
      text: `Page ${page + 1}/${pages} · Owned ${items.length}/${ctx.cards.length} cards`,
    });
  if (items.length === 0)
    embed.setDescription("No cards yet. Use `/daily` to get your first cards.");

  const slice = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const image =
    slice.length > 0
      ? await tryRender(ctx, (r) =>
          r.cards(
            slice.map(({ def, active }) => ({
              def,
              variant: active,
            })),
          ),
        )
      : null;
  if (!image) {
    for (const { def } of slice)
      embed.addFields({
        name: def.name,
        value: cardSummary(def),
      });
  }

  // When viewing another player, the page buttons carry the target id so paging keeps viewing them.
  // Self-view keeps `collection:<page>` (no target) for backward compatibility.
  const suffix = targetId ? `:${targetId}` : "";
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`collection:${page - 1}${suffix}`)
      .setLabel("◀")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`collection:${page + 1}${suffix}`)
      .setLabel("▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= pages - 1),
  );
  return {
    embeds: [embed],
    components: [row],
    files: image ? [attach(image, `collection-${page}.png`)] : [],
  };
}

export const collectionCommand: Command = {
  data: slash("collection", "View the cards you own").addUserOption((o) =>
    o.setName("user").setDescription("View another player's collection"),
  ),

  async execute(interaction, ctx) {
    const target = interaction.options.getUser("user") ?? interaction.user;
    const viewingOther = target.id !== interaction.user.id;
    const player = ctx.repo.get(target.id);

    if (viewingOther && !hasPlayed(player)) {
      await interaction.reply({
        content: "That player hasn't started yet.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      ...(await view(player, ctx, 0, viewingOther ? target.id : undefined)),
      flags: MessageFlags.Ephemeral,
    });
  },

  async component(interaction, ctx) {
    if (!interaction.isButton()) return;
    // `collection:<page>` for self, `collection:<page>:<targetId>` when paging another player's cards.
    const [, pageRaw, targetId] = interaction.customId.split(":");
    const page = Number(pageRaw);
    const player = ctx.repo.get(targetId ?? interaction.user.id);
    // `attachments: []` drops the previous page's image so only the new one stays.
    await interaction.update({
      ...(await view(player, ctx, Number.isFinite(page) ? page : 0, targetId)),
      attachments: [],
    });
  },
};

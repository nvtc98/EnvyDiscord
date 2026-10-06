import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { EMBED_COLOR } from "../../render/theme";
import type { Player } from "../../game/player";
import { slash, type AppContext, type Command } from "../command";
import { isOwner } from "../owner";

// Match story-view.ts's embed-description cap so a long player list never overflows Discord's limit.
const DESC_CAP = 3800;
// Players per page in the summary list.
const PAGE_SIZE = 20;

/** Cards the player owns that still exist in the current card list. */
function cardCount(player: Player, ctx: AppContext): number {
  return Object.keys(player.cards).filter((id) => ctx.cardIndex.has(id)).length;
}

/** One compact line per player: who they are, where they are in the story, how many cards they own. */
function summaryLine(player: Player, ctx: AppContext): string {
  const where = player.story?.node ?? "not started";
  return `<@${player.id}> · ${where} · owns ${cardCount(player, ctx)} cards`;
}

function summaryPage(
  players: Player[],
  ctx: AppContext,
  requestedPage: number,
) {
  const pages = Math.max(1, Math.ceil(players.length / PAGE_SIZE));
  const page = Math.min(Math.max(0, requestedPage), pages - 1);
  const slice = players.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const description =
    slice.length > 0
      ? slice
          .map((p) => summaryLine(p, ctx))
          .join("\n")
          .slice(0, DESC_CAP)
      : "No players yet.";
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR.neutral)
    .setTitle("🛠️ Players")
    .setDescription(description)
    .setFooter({
      text: `Page ${page + 1}/${pages} · ${players.length} players`,
    });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`admin:${page - 1}`)
      .setLabel("◀")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`admin:${page + 1}`)
      .setLabel("▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= pages - 1),
  );
  return { embeds: [embed], components: [row] };
}

/** Detailed view of one player's story progress and the information they have entered. */
function detailEmbed(player: Player, ctx: AppContext): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR.profile)
    .setTitle(`🛠️ <@${player.id}>`);
  const story = player.story;
  if (!story) {
    embed.setDescription("This player hasn't started yet.");
    embed.addFields({
      name: "🎴 Cards",
      value: `owns ${cardCount(player, ctx)}`,
      inline: true,
    });
    return embed;
  }

  const yesNo = (v: boolean | null) => (v === null ? "—" : v ? "yes" : "no");
  const attempts =
    story.nameAttempts.length > 0
      ? story.nameAttempts
          .map(
            (a) =>
              `• \`${a.typed}\` → ${a.result}${a.suggestion ? ` (suggested ${a.suggestion})` : ""}`,
          )
          .join("\n")
          .slice(0, 1024)
      : "—";

  embed.addFields(
    { name: "Scene", value: story.node, inline: true },
    { name: "Name", value: story.name ?? "—", inline: true },
    { name: "One of The Eyes?", value: yesNo(story.isEye), inline: true },
    { name: "Knows the tribe?", value: yesNo(story.knowsTribe), inline: true },
    { name: "Pack open?", value: story.pack ? "yes" : "no", inline: true },
    {
      name: "Starter claimed?",
      value: yesNo(story.starterClaimed),
      inline: true,
    },
    { name: "Name attempts", value: attempts },
    { name: "🎴 Cards", value: `owns ${cardCount(player, ctx)}`, inline: true },
  );
  return embed;
}

export const adminCommand: Command = {
  data: slash("admin", "Owner only: view players").addSubcommand((s) =>
    s
      .setName("summary")
      .setDescription("List all players, or view one")
      .addUserOption((o) =>
        o.setName("user").setDescription("View one player"),
      ),
  ),

  async execute(interaction, ctx) {
    const reply = (payload: object) =>
      interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });

    if (!(await isOwner(interaction.client, interaction.user.id))) {
      await reply({ content: "Only the bot owner may wield this command." });
      return;
    }

    const target = interaction.options.getUser("user");
    if (target) {
      const player = ctx.repo.get(target.id);
      ctx.log.game("admin_summary", {
        by: interaction.user.id,
        target: target.id,
      });
      await reply({ embeds: [detailEmbed(player, ctx)] });
      return;
    }

    const players = ctx.repo.all();
    ctx.log.game("admin_summary", { by: interaction.user.id });
    await reply(summaryPage(players, ctx, 0));
  },

  async component(interaction, ctx) {
    if (!interaction.isButton()) return;
    if (!(await isOwner(interaction.client, interaction.user.id))) {
      await interaction.update({ components: [] });
      return;
    }
    const page = Number(interaction.customId.split(":")[1]);
    const players = ctx.repo.all();
    await interaction.update(
      summaryPage(players, ctx, Number.isFinite(page) ? page : 0),
    );
  },
};

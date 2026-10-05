import { EmbedBuilder, MessageFlags } from "discord.js";
import { todayKey } from "../../game/gacha";
import { hasPlayed } from "../../game/player";
import { EMBED_COLOR } from "../../render/theme";
import { slash, type Command } from "../command";

export const profileCommand: Command = {
  data: slash("profile", "Behold thy standing").addUserOption((o) =>
    o
      .setName("user")
      .setDescription("Behold another's standing (for the eyes only)"),
  ),

  async execute(interaction, ctx) {
    const target = interaction.options.getUser("user") ?? interaction.user;
    const viewingOther = target.id !== interaction.user.id;
    const player = ctx.repo.get(target.id);

    if (viewingOther && !hasPlayed(player)) {
      await interaction.reply({
        content: "That soul hath not yet set foot upon the road.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const games = player.wins + player.losses;
    const rate =
      games > 0 ? `${Math.round((player.wins / games) * 100)}%` : "—";
    const claimed = player.lastDaily === todayKey(new Date(), ctx.timezone);

    const avatarUrl = target.displayAvatarURL({ size: 128 });

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR.profile)
      .setTitle(`👤 The record of ${target.displayName}`)
      .setThumbnail(avatarUrl)
      .addFields(
        { name: "💰 Coins", value: String(player.coins), inline: true },
        {
          name: "🏆 Wins / Losses",
          value: `${player.wins} / ${player.losses} (${rate})`,
          inline: true,
        },
        {
          name: "🎴 Cards",
          value: `${Object.keys(player.cards).filter((id) => ctx.cardIndex.has(id)).length}/${ctx.cards.length}`,
          inline: true,
        },
        {
          name: "🎁 Daily pack this day",
          value: claimed ? "Claimed" : "Not yet claimed",
          inline: true,
        },
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

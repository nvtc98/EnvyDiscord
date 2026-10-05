import { EmbedBuilder, MessageFlags } from "discord.js";
import { DEFAULT_VARIANT, type VariantId } from "../../data/variants";
import { claimDaily, todayKey } from "../../game/gacha";
import type { GrantResult } from "../../game/player";
import { EMBED_COLOR } from "../../render/theme";
import { slash, type Command } from "../command";
import { attach, tryRender } from "../images";
import { cardSummary, variantLabel } from "../render";

/** The variant a grant should be drawn with: the one it granted, or metal when a duplicate was refunded. */
const grantVariant = (grant: GrantResult): VariantId =>
  grant.variant ?? DEFAULT_VARIANT;

function describeGrant(grant: GrantResult): string {
  if (grant.kind === "new")
    return `🆕 **${grant.card.name}** · ${cardSummary(grant.card)}`;
  if (grant.kind === "variant-unlocked")
    return `🎨 **${grant.card.name}** unlocked the **${variantLabel(grant.variant!)}** variant`;
  return `💰 **${grant.card.name}** was a duplicate · refunded **${grant.refund}** coins`;
}

export const dailyCommand: Command = {
  data: slash("daily", "Claim your free daily card pack"),

  async execute(interaction, ctx) {
    const player = ctx.repo.get(interaction.user.id);
    if (!player.story?.starterClaimed) {
      await interaction.reply({
        content:
          "Your story has not begun yet. Use `/story` first. Your first cards are waiting there; `/daily` unlocks afterwards.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const result = claimDaily(
      player,
      ctx.cards,
      todayKey(new Date(), ctx.timezone),
      ctx.rng,
    );
    if (!result.ok) {
      const content =
        result.reason === "already-claimed"
          ? "⏳ You already claimed your pack today. Come back tomorrow!"
          : "🏆 Your collection is complete: every card owns every variant, so there is nothing left to receive.";
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      return;
    }
    await ctx.repo.save(player);
    ctx.log.game("daily_claimed", {
      userId: interaction.user.id,
      username: interaction.user.username,
      grants: result.grants.map((g) => ({
        card: g.card.id,
        result: g.kind,
        variant: g.variant,
        refund: g.refund,
      })),
      coinsAwarded: result.coins,
      coinsTotal: player.coins,
    });

    const refunded = result.grants.reduce((sum, g) => sum + (g.refund ?? 0), 0);
    const footer =
      refunded > 0
        ? `+${result.coins} coins (+${refunded} refunded) · Total: ${player.coins} coins`
        : `+${result.coins} coins · Total: ${player.coins} coins`;
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR.daily)
      .setTitle("🎁 Daily pack")
      .setDescription(result.grants.map(describeGrant).join("\n"))
      .setFooter({ text: footer });

    const image = await tryRender(ctx, (r) =>
      r.cards(
        result.grants.map((g) => ({
          def: g.card,
          variant: grantVariant(g),
          badge:
            g.kind === "new"
              ? "NEW"
              : g.variant
                ? variantLabel(g.variant)
                : "DUP",
        })),
      ),
    );
    await interaction.reply({
      embeds: [embed],
      files: image ? [attach(image, "daily.png")] : [],
    });
  },
};

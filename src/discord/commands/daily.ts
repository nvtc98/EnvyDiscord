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
    return `🎨 **${grant.card.name}** revealed its **${variantLabel(grant.variant!)}** variant`;
  return `💰 **${grant.card.name}** came up again · **${grant.refund}** coins refunded`;
}

export const dailyCommand: Command = {
  data: slash("daily", "Claim your free daily pack of cards"),

  async execute(interaction, ctx) {
    const player = ctx.repo.get(interaction.user.id);
    if (!player.story?.starterClaimed) {
      await interaction.reply({
        content:
          "Your story hasn't started yet. Use `/story` first — your first cards are there, and `/daily` opens after that.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const result = claimDaily(
      player,
      ctx.collectibleCards,
      todayKey(new Date(), ctx.timezone),
      ctx.rng,
    );
    if (!result.ok) {
      const content =
        result.reason === "already-claimed"
          ? "⏳ You've already claimed your pack today. Come back tomorrow."
          : "🏆 Your collection is complete: every card has every variant, so there's nothing left to receive.";
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
        ? `+${result.coins} coins (+${refunded} refunded) · In all: ${player.coins} coins`
        : `+${result.coins} coins · In all: ${player.coins} coins`;
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR.daily)
      .setTitle("🎁 Your daily pack")
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

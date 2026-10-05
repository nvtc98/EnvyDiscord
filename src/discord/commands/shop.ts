import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandStringOption,
} from "discord.js";
import { DEFAULT_VARIANT, purchasableVariants } from "../../data/variants";
import { cardVariants } from "../../game/player";
import {
  buyCard,
  buyVariant,
  SHOP_CARD_PRICE,
  SHOP_VARIANT_PRICE,
} from "../../game/shop";
import { EMBED_COLOR } from "../../render/theme";
import { slash, type Command } from "../command";
import { attach, tryRender } from "../images";
import { cardSummary, variantLabel } from "../render";

export const shopCommand: Command = {
  data: slash("shop", "Spend thy coins upon cards")
    .addSubcommand((sub) =>
      sub
        .setName("card")
        .setDescription(`Summon a card unknown for ${SHOP_CARD_PRICE} coins`),
    )
    .addSubcommand((sub) =>
      sub
        .setName("variant")
        .setDescription(
          `Claim a colour variant for a card thou ownest (${SHOP_VARIANT_PRICE} coins)`,
        )
        .addStringOption(
          new SlashCommandStringOption()
            .setName("card")
            .setDescription("For which card to claim a variant")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((opt) => {
          opt
            .setName("variant")
            .setDescription("Which variant to claim")
            .setRequired(true);
          for (const v of purchasableVariants())
            opt.addChoices({ name: v.name, value: v.id });
          return opt;
        }),
    ),

  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const player = ctx.repo.get(interaction.user.id);

    if (sub === "card") {
      const result = buyCard(player, ctx.cards, ctx.rng);
      if (!result.ok) {
        const msg =
          result.reason === "insufficient-coins"
            ? `❌ Thou needest **${SHOP_CARD_PRICE} coins** to summon a card. Thy purse holds **${player.coins}**.`
            : "🏆 Thy collection is complete — naught remains to be bought.";
        await interaction.reply({
          content: msg,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await ctx.repo.save(player);
      ctx.log.game("shop_card", {
        userId: interaction.user.id,
        username: interaction.user.username,
        card: result.grant.card.id,
        result: result.grant.kind,
        variant: result.grant.variant,
        refund: result.grant.refund,
        coinsSpent: result.coinsSpent,
        coinsTotal: player.coins,
      });

      const grant = result.grant;
      const description =
        grant.kind === "new"
          ? `🆕 **${grant.card.name}** · ${cardSummary(grant.card)}`
          : grant.kind === "variant-unlocked"
            ? `🎨 **${grant.card.name}** hath revealed its **${variantLabel(grant.variant!)}** variant`
            : `💰 **${grant.card.name}** came twice over · **${grant.refund}** coins returned to thy purse`;
      const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR.daily)
        .setTitle("🛒 A card claimed")
        .setDescription(description)
        .setFooter({
          text: `-${result.coinsSpent} coins · Thy purse holds: ${player.coins} coins`,
        });

      const image = await tryRender(ctx, (r) =>
        r.cards([
          {
            def: grant.card,
            variant: grant.variant ?? DEFAULT_VARIANT,
            badge:
              grant.kind === "new"
                ? "NEW"
                : grant.variant
                  ? variantLabel(grant.variant)
                  : "DUP",
          },
        ]),
      );
      await interaction.reply({
        embeds: [embed],
        files: image ? [attach(image, "shop.png")] : [],
      });
      return;
    }

    if (sub === "variant") {
      const cardName = interaction.options.getString("card", true);
      const variantId = interaction.options.getString("variant", true);
      const card = ctx.cards.find(
        (c) =>
          c.id === cardName || c.name.toLowerCase() === cardName.toLowerCase(),
      );
      if (!card) {
        await interaction.reply({
          content: `❌ No such card is known to me: **${cardName}**`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const result = buyVariant(player, card, variantId);
      if (!result.ok) {
        const msg: Record<string, string> = {
          "insufficient-coins": `❌ Thou needest **${SHOP_VARIANT_PRICE} coins** to claim a variant. Thy purse holds **${player.coins}**.`,
          "not-owned": `❌ **${card.name}** is not yet thine. Claim it first with \`/shop card\`.`,
          "already-owned": `✨ Thou dost already own the **${variantLabel(variantId)}** variant of **${card.name}**.`,
          "not-purchasable": `❌ The **${variantLabel(variantId)}** variant cannot be claimed in the shop.`,
        };
        await interaction.reply({
          content: msg[result.reason] ?? "❌ That variant cannot be claimed.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await ctx.repo.save(player);
      ctx.log.game("shop_variant", {
        userId: interaction.user.id,
        username: interaction.user.username,
        card: card.id,
        variant: result.variant,
        coinsSpent: result.coinsSpent,
        coinsTotal: player.coins,
      });

      const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR.victory)
        .setTitle("✨ A variant claimed")
        .setDescription(
          `🎨 **${card.name}** hath gained the **${variantLabel(result.variant)}** variant`,
        )
        .setFooter({
          text: `-${result.coinsSpent} coins · Thy purse holds: ${player.coins} coins`,
        });

      const image = await tryRender(ctx, (r) =>
        r.cards([
          {
            def: card,
            variant: result.variant,
            badge: variantLabel(result.variant),
          },
        ]),
      );
      await interaction.reply({
        embeds: [embed],
        files: image ? [attach(image, "shop.png")] : [],
      });
    }
  },

  async autocomplete(interaction, ctx) {
    const focused = interaction.options.getFocused().toLowerCase();
    const player = ctx.repo.get(interaction.user.id);
    // Owned cards that still have at least one purchasable variant the player does not yet own.
    const purchasableIds = purchasableVariants().map((v) => v.id);
    const owned = ctx.cards
      .filter((c) => {
        const have = cardVariants(player, c.id);
        return have.length > 0 && purchasableIds.some((v) => !have.includes(v));
      })
      .filter((c) => c.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((c) => ({ name: c.name, value: c.id }));
    await interaction.respond(owned);
  },
};

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
} from "discord.js";
import { DEFAULT_VARIANT, purchasableVariants } from "../../data/variants";
import { cardVariants, type GrantResult } from "../../game/player";
import {
  buyCard,
  buyVariant,
  SHOP_CARD_PRICE,
  SHOP_VARIANT_PRICE,
} from "../../game/shop";
import { EMBED_COLOR } from "../../render/theme";
import { slash, type AppContext, type Command } from "../command";
import { attach, tryRender } from "../images";
import { cardSummary, variantLabel } from "../render";

/** A select menu holds at most 25 options. */
const SELECT_CAP = 25;

/** Present the summon-card result embed + image on the chosen interaction (update or reply). */
async function buildCardResult(
  ctx: AppContext,
  grant: GrantResult,
  coinsSpent: number,
  coins: number,
) {
  const description =
    grant.kind === "new"
      ? `🆕 **${grant.card.name}** · ${cardSummary(grant.card)}`
      : grant.kind === "variant-unlocked"
        ? `🎨 **${grant.card.name}** revealed its **${variantLabel(grant.variant!)}** variant`
        : `💰 **${grant.card.name}** came up again · **${grant.refund}** gold refunded`;
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR.daily)
    .setTitle("🛒 Card bought")
    .setDescription(description)
    .setFooter({
      text: `-${coinsSpent} gold · You now have ${coins} gold`,
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
  return {
    embeds: [embed],
    files: image ? [attach(image, "shop.png")] : [],
  };
}

export const shopCommand: Command = {
  data: slash("shop", "Spend your gold on cards and variants"),

  async execute(interaction, ctx) {
    const player = ctx.repo.get(interaction.user.id);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("shop:summon")
        .setLabel(`Buy a card (${SHOP_CARD_PRICE} gold)`)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("shop:variant")
        .setLabel(`Buy a variant (${SHOP_VARIANT_PRICE} gold)`)
        .setStyle(ButtonStyle.Secondary),
    );
    await interaction.reply({
      content: `You have **${player.coins} gold**. What would you like to buy?`,
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
  },

  async component(interaction, ctx) {
    const [, action, ...rest] = interaction.customId.split(":");
    const player = ctx.repo.get(interaction.user.id);

    if (interaction.isButton() && action === "summon") {
      const result = buyCard(player, ctx.collectibleCards, ctx.rng);
      if (!result.ok) {
        const msg =
          result.reason === "insufficient-coins"
            ? `❌ You need **${SHOP_CARD_PRICE} gold** to buy a card. You have **${player.coins}**.`
            : "🏆 Your collection is complete — there's nothing left to buy.";
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
      await interaction.reply({
        ...(await buildCardResult(
          ctx,
          result.grant,
          result.coinsSpent,
          player.coins,
        )),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.isButton() && action === "variant") {
      const purchasableIds = purchasableVariants().map((v) => v.id);
      const eligible = ctx.collectibleCards.filter((c) => {
        const have = cardVariants(player, c.id);
        return have.length > 0 && purchasableIds.some((v) => !have.includes(v));
      });
      if (eligible.length === 0) {
        await interaction.reply({
          content:
            "❌ You have no card that can take a new variant. Buy more cards first.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const shown = eligible.slice(0, SELECT_CAP);
      const menu = new StringSelectMenuBuilder()
        .setCustomId("shop:pickcard")
        .setPlaceholder("Pick a card")
        .addOptions(
          shown.map((c) => ({
            label: c.name,
            description: cardSummary(c).slice(0, 100),
            value: c.id,
          })),
        );
      await interaction.reply({
        content: `Pick a card to add a variant to.${eligible.length > shown.length ? ` (showing the first ${shown.length} of ${eligible.length}; the rest will follow)` : ""}`,
        components: [
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.isStringSelectMenu() && action === "pickcard") {
      const cardId = interaction.values[0];
      const card = ctx.collectibleCardIndex.get(cardId);
      if (!card) {
        await interaction.update({
          content: "❌ No card by that name.",
          components: [],
        });
        return;
      }
      const owned = cardVariants(player, card.id);
      const options = purchasableVariants()
        .filter((v) => !owned.includes(v.id))
        .slice(0, SELECT_CAP)
        .map((v) => ({ label: v.name, value: v.id }));
      if (options.length === 0) {
        await interaction.update({
          content: `✨ You already own every variant of **${card.name}**.`,
          components: [],
        });
        return;
      }
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`shop:pickvariant:${card.id}`)
        .setPlaceholder("Pick a variant")
        .addOptions(options);
      await interaction.update({
        content: `Pick a variant for **${card.name}** (${SHOP_VARIANT_PRICE} gold).`,
        components: [
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
        ],
      });
      return;
    }

    if (interaction.isStringSelectMenu() && action === "pickvariant") {
      const cardId = rest[0];
      const variantId = interaction.values[0];
      const card = ctx.collectibleCardIndex.get(cardId);
      if (!card) {
        await interaction.update({
          content: "❌ No card by that name.",
          components: [],
        });
        return;
      }
      const result = buyVariant(player, card, variantId);
      if (!result.ok) {
        const msg: Record<string, string> = {
          "insufficient-coins": `❌ You need **${SHOP_VARIANT_PRICE} gold** to buy a variant. You have **${player.coins}**.`,
          "not-owned": `❌ You don't own **${card.name}** yet. Buy it first at the shop.`,
          "already-owned": `✨ You already own the **${variantLabel(variantId)}** variant of **${card.name}**.`,
          "not-purchasable": `❌ The **${variantLabel(variantId)}** variant can't be bought in the shop.`,
        };
        await interaction.update({
          content: msg[result.reason] ?? "❌ That variant can't be bought.",
          components: [],
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
        .setTitle("✨ Variant bought")
        .setDescription(
          `🎨 **${card.name}** gained the **${variantLabel(result.variant)}** variant`,
        )
        .setFooter({
          text: `-${result.coinsSpent} gold · You now have ${player.coins} gold`,
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
      await interaction.update({
        content: "",
        embeds: [embed],
        files: image ? [attach(image, "shop.png")] : [],
        components: [],
      });
      return;
    }
  },
};

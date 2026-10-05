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
        ? `🎨 **${grant.card.name}** hath revealed its **${variantLabel(grant.variant!)}** variant`
        : `💰 **${grant.card.name}** came twice over · **${grant.refund}** coins returned to thy purse`;
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR.daily)
    .setTitle("🛒 A card claimed")
    .setDescription(description)
    .setFooter({
      text: `-${coinsSpent} coins · Thy purse holds: ${coins} coins`,
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
  data: slash(
    "shop",
    "Tarry at the shop and spend thy coins upon cards and hues",
  ),

  async execute(interaction, ctx) {
    const player = ctx.repo.get(interaction.user.id);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("shop:summon")
        .setLabel(`Summon a The Eyes card (${SHOP_CARD_PRICE} coins)`)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("shop:variant")
        .setLabel(`Seek a new hue (${SHOP_VARIANT_PRICE} coins)`)
        .setStyle(ButtonStyle.Secondary),
    );
    await interaction.reply({
      content: `Welcome, traveler. Thy purse holds **${player.coins} coins**. What dost thou seek?`,
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
  },

  async component(interaction, ctx) {
    const [, action, ...rest] = interaction.customId.split(":");
    const player = ctx.repo.get(interaction.user.id);

    if (interaction.isButton() && action === "summon") {
      const result = buyCard(player, ctx.cards, ctx.rng);
      if (!result.ok) {
        const msg =
          result.reason === "insufficient-coins"
            ? `❌ Thou needest **${SHOP_CARD_PRICE} coins** to summon a card. Thy purse holds **${player.coins}**.`
            : "🏆 Thy collection is complete — naught remains to be summoned.";
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
      const eligible = ctx.cards.filter((c) => {
        const have = cardVariants(player, c.id);
        return have.length > 0 && purchasableIds.some((v) => !have.includes(v));
      });
      if (eligible.length === 0) {
        await interaction.reply({
          content:
            "❌ No card of thine awaits a new hue. Summon more cards, then return.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const shown = eligible.slice(0, SELECT_CAP);
      const menu = new StringSelectMenuBuilder()
        .setCustomId("shop:pickcard")
        .setPlaceholder("Which card shall gain a new hue?")
        .addOptions(
          shown.map((c) => ({
            label: c.name,
            description: cardSummary(c).slice(0, 100),
            value: c.id,
          })),
        );
      await interaction.reply({
        content: `Choose the card thou wouldst adorn.${eligible.length > shown.length ? ` (showing but the first ${shown.length} of ${eligible.length}; the rest shall await)` : ""}`,
        components: [
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.isStringSelectMenu() && action === "pickcard") {
      const cardId = interaction.values[0];
      const card = ctx.cards.find((c) => c.id === cardId);
      if (!card) {
        await interaction.update({
          content: "❌ No such card is known to me.",
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
          content: `✨ Thou dost already own every hue of **${card.name}**.`,
          components: [],
        });
        return;
      }
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`shop:pickvariant:${card.id}`)
        .setPlaceholder("Which hue dost thou desire?")
        .addOptions(options);
      await interaction.update({
        content: `Choose a hue for **${card.name}** (${SHOP_VARIANT_PRICE} coins).`,
        components: [
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
        ],
      });
      return;
    }

    if (interaction.isStringSelectMenu() && action === "pickvariant") {
      const cardId = rest[0];
      const variantId = interaction.values[0];
      const card = ctx.cards.find((c) => c.id === cardId);
      if (!card) {
        await interaction.update({
          content: "❌ No such card is known to me.",
          components: [],
        });
        return;
      }
      const result = buyVariant(player, card, variantId);
      if (!result.ok) {
        const msg: Record<string, string> = {
          "insufficient-coins": `❌ Thou needest **${SHOP_VARIANT_PRICE} coins** to claim a variant. Thy purse holds **${player.coins}**.`,
          "not-owned": `❌ **${card.name}** is not yet thine. Summon it first at the shop.`,
          "already-owned": `✨ Thou dost already own the **${variantLabel(variantId)}** variant of **${card.name}**.`,
          "not-purchasable": `❌ The **${variantLabel(variantId)}** variant cannot be claimed in the shop.`,
        };
        await interaction.update({
          content: msg[result.reason] ?? "❌ That variant cannot be claimed.",
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

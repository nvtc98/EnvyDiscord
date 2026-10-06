import { MessageFlags } from "discord.js";
import { DEFAULT_VARIANT } from "../../data/variants";
import { activeVariant } from "../../game/player";
import { normalize } from "../../util/text";
import { slash, type Command } from "../command";
import { attach, tryRender } from "../images";
import { cardEmbed, variantLabel } from "../render";

export const cardCommand: Command = {
  data: slash("card", "View a card's details").addStringOption((option) =>
    option
      .setName("name")
      .setDescription("Card name")
      .setRequired(true)
      .setAutocomplete(true),
  ),

  async autocomplete(interaction, ctx) {
    const query = normalize(interaction.options.getFocused());
    const choices = ctx.cards
      .filter((c) => normalize(c.name).includes(query))
      .slice(0, 25)
      .map((c) => ({
        name: `${c.name} · cost ${c.cost}, power ${c.power}`,
        value: c.id,
      }));
    await interaction.respond(choices);
  },

  async execute(interaction, ctx) {
    const input = interaction.options.getString("name", true);
    const wanted = normalize(input);
    const def =
      ctx.cardIndex.get(input) ??
      ctx.cards.find((c) => normalize(c.name) === wanted);
    if (!def) {
      await interaction.reply({
        content: `No card named "${input}".`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const active = activeVariant(ctx.repo.get(interaction.user.id), def.id);
    const note = active
      ? `You own this card · ${variantLabel(active)} variant`
      : "You don't own this card yet";
    const variant = active ?? DEFAULT_VARIANT;

    const image = await tryRender(ctx, (r) =>
      r.cards([{ def, variant }], { scale: 2 }),
    );
    if (image) {
      await interaction.reply({
        content: `**${def.name}** · ${note}`,
        files: [attach(image, `${def.id}.png`)],
      });
      return;
    }
    await interaction.reply({ embeds: [cardEmbed(def, variant, note)] });
  },
};

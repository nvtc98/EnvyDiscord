import { MessageFlags } from "discord.js";
import type { Difficulty } from "../../engine/ai";
import { opponentDeck, resolveDeck } from "../../game/deck";
import { renderBattle } from "../battle-view";
import {
  handleBattleComponent,
  startBattle,
  withImage,
} from "../battle-session";
import { slash, type Command } from "../command";
import { isOwner } from "../owner";

export const battleCommand: Command = {
  data: slash(
    "battle",
    "Do battle against the foe across three lanes",
  ).addStringOption((option) =>
    option
      .setName("difficulty")
      .setDescription("The measure of the foe (default: normal)")
      .addChoices(
        { name: "Easy", value: "easy" },
        { name: "Normal", value: "normal" },
        { name: "Hard", value: "hard" },
      ),
  ),

  async execute(interaction, ctx) {
    // Practice battles are for the owner while the story is being built; players reach battles through /story.
    if (!(await isOwner(interaction.client, interaction.user.id))) {
      await interaction.reply({
        content:
          "Battles are woven into the tale now. Speak `/story` to go on.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const player = ctx.repo.get(interaction.user.id);
    const difficulty = (interaction.options.getString("difficulty") ??
      "normal") as Difficulty;
    const deck = resolveDeck(player, ctx.cards, ctx.cardIndex, ctx.rng);
    const enemyDeck = opponentDeck(ctx.cards, ctx.rng);

    const session = startBattle({
      ctx,
      userId: interaction.user.id,
      username: interaction.user.username,
      deck: deck.cards,
      opponentDeck: enemyDeck,
      difficulty,
      variants: Object.fromEntries(
        Object.entries(player.cards).map(([id, owned]) => [id, owned.active]),
      ),
      guests: deck.guests,
      origin: "practice",
      opponentPortrait: null,
      playerAvatarUrl: interaction.user.displayAvatarURL({
        extension: "png",
        size: 128,
      }),
    });

    await interaction.reply({
      ...renderBattle(await withImage(ctx, session)),
      flags: MessageFlags.Ephemeral,
    });
  },

  async component(interaction, ctx) {
    await handleBattleComponent(interaction, ctx);
  },
};

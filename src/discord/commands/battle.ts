import { MessageFlags } from "discord.js";
import type { Difficulty } from "../../engine/ai";
import { opponentDeck, resolveDeck } from "../../game/deck";
import { renderBattle } from "../battle-view";
import {
  animateOpeningTurn,
  handleBattleComponent,
  opponentOpens,
  startBattle,
  withImage,
  type AnimationSurface,
} from "../battle-session";
import { slash, type Command } from "../command";
import { isOwner } from "../owner";

export const battleCommand: Command = {
  data: slash(
    "battle",
    "Battle an opponent across three lanes",
  ).addStringOption((option) =>
    option
      .setName("difficulty")
      .setDescription("Opponent difficulty (default: normal)")
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
        content: "Battles are part of the story now. Use `/story` to continue.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const player = ctx.repo.get(interaction.user.id);
    const difficulty = (interaction.options.getString("difficulty") ??
      "normal") as Difficulty;
    const deck = resolveDeck(
      player,
      ctx.collectibleCards,
      ctx.cardIndex,
      ctx.rng,
    );
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
      playerName: player.story?.name ?? undefined,
      // opponentName left undefined so the renderer's "The Enemy" default applies (practice has no story opponent).
    });

    const screen = renderBattle(await withImage(ctx, session));
    if (opponentOpens(session)) {
      // Opponent opens: post the board CONTROL-LESS as the single ack, then animate the opening turn.
      await interaction.reply({
        ...screen,
        components: [],
        flags: MessageFlags.Ephemeral,
      });
      const surface: AnimationSurface = {
        interaction: null,
        // Frame 0 (the enemy's opening card on the board) edits the control-less reply in place.
        showFirstFrame: (p) =>
          interaction
            .editReply({ ...p, components: [], attachments: [] })
            .then(() => {}),
        editFrame: (p) =>
          interaction
            .editReply({ ...p, components: [], attachments: [] })
            .then(() => {}),
        // Final board WITH controls: components NOT stripped; attachments dropped so no second image stacks.
        showControls: (p) =>
          interaction.editReply({ ...p, attachments: [] }).then(() => {}),
      };
      await animateOpeningTurn(ctx, session, surface);
      return;
    }
    // Human goes first: post the board WITH controls (turn 1), exactly as before.
    await interaction.reply({
      ...screen,
      flags: MessageFlags.Ephemeral,
    });
  },

  async component(interaction, ctx) {
    await handleBattleComponent(interaction, ctx);
  },
};

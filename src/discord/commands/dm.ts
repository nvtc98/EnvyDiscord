import { DiscordAPIError, MessageFlags, RESTJSONErrorCodes, Team, type Client } from 'discord.js';
import { slash, type Command } from '../command';

/** The application's owner (or every member of the owning team). Only they may use /dm. */
async function isOwner(client: Client<true>, userId: string): Promise<boolean> {
  const app = await client.application.fetch();
  const owner = app.owner;
  if (!owner) return false;
  return owner instanceof Team ? owner.members.has(userId) : owner.id === userId;
}

export const dmCommand: Command = {
  data: slash('dm', 'Owner only: send a direct message to a user as the bot')
    .addStringOption((option) =>
      option.setName('message').setDescription('What to send').setRequired(true).setMaxLength(2000),
    )
    .addUserOption((option) => option.setName('user').setDescription('Who to message'))
    .addStringOption((option) => option.setName('user-id').setDescription('Or paste a user ID')),

  async execute(interaction, ctx) {
    const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

    // Without this check anyone with the app installed could make the bot message strangers.
    if (!(await isOwner(interaction.client, interaction.user.id))) {
      await reply('Only the bot owner can use this command.');
      return;
    }

    const userId = interaction.options.getUser('user')?.id ?? interaction.options.getString('user-id')?.trim();
    if (!userId || !/^\d{17,20}$/.test(userId)) {
      await reply('Pick a user, or paste a valid numeric user ID.');
      return;
    }

    try {
      const user = await interaction.client.users.fetch(userId);
      if (user.bot) {
        await reply('Bots cannot receive direct messages from other bots.');
        return;
      }
      // Repeat the text verbatim but never ping anyone through it.
      const content = interaction.options.getString('message', true);
      await user.send({ content, allowedMentions: { parse: [] } });
      ctx.log.message('owner_dm', { userId: interaction.user.id, targetId: userId, ok: true, content: ctx.log.text(content) });
      await reply(`✅ Sent to **${user.username}**.`);
    } catch (error) {
      ctx.log.message('owner_dm', {
        userId: interaction.user.id,
        targetId: userId,
        ok: false,
        error: error instanceof DiscordAPIError ? `${error.code}: ${error.message}` : String(error),
      });
      if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.CannotSendMessagesToThisUser) {
        await reply(
          "❌ Discord refused: that user has DMs closed, or doesn't share a server with the bot. " +
            'A bot can only message people who share a server with it and allow DMs from server members.',
        );
        return;
      }
      if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownUser) {
        await reply("❌ Discord doesn't know a user with that ID.");
        return;
      }
      throw error;
    }
  },
};

import { slash, type Command } from '../command';

export const sayCommand: Command = {
  data: slash('say', 'Make the bot say exactly what you type').addStringOption((option) =>
    option.setName('content').setDescription('What the bot should say').setRequired(true).setMaxLength(2000),
  ),

  async execute(interaction) {
    await interaction.reply({
      content: interaction.options.getString('content', true),
      // Repeat the text verbatim but never ping @everyone, @here, roles or users through the bot.
      allowedMentions: { parse: [] },
    });
  },
};

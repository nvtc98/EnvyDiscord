import { slash, type Command } from '../command';

export const mercifulCommand: Command = {
  data: slash('merciful', 'Make the bot say a line'),

  async execute(interaction) {
    await interaction.reply('Merciful be, all my eyes.');
  },
};

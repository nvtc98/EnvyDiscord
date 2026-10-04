import { MessageFlags } from 'discord.js';
import { slash, type Command } from '../command';

/** An interaction token works for 15 minutes; stop a minute short so the send never races the expiry. */
const MAX_SECONDS = 14 * 60;
const MIN_SECONDS = 5;
const MAX_PENDING_PER_USER = 3;

/** Timers live in memory only: a restart drops anything still waiting. */
const pending = new Map<string, number>();

export const sayLaterCommand: Command = {
  data: slash('say-later', 'The bot says a line in this chat after a delay (up to 14 minutes)')
    .addStringOption((option) =>
      option.setName('content').setDescription('What the bot should say').setRequired(true).setMaxLength(2000),
    )
    .addIntegerOption((option) =>
      option
        .setName('seconds')
        .setDescription(`Delay in seconds (${MIN_SECONDS} to ${MAX_SECONDS})`)
        .setRequired(true)
        .setMinValue(MIN_SECONDS)
        .setMaxValue(MAX_SECONDS),
    ),

  async execute(interaction, ctx) {
    const userId = interaction.user.id;
    const waiting = pending.get(userId) ?? 0;
    if (waiting >= MAX_PENDING_PER_USER) {
      await interaction.reply({
        content: `You already have ${MAX_PENDING_PER_USER} messages waiting. Let one arrive first.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const content = interaction.options.getString('content', true);
    const seconds = interaction.options.getInteger('seconds', true);
    pending.set(userId, waiting + 1);
    const release = () => {
      const left = (pending.get(userId) ?? 1) - 1;
      if (left <= 0) pending.delete(userId);
      else pending.set(userId, left);
    };

    try {
      // Only the caller sees this confirmation; the delayed line below is public.
      await interaction.reply({ content: `⏳ I'll say it in ${seconds}s.`, flags: MessageFlags.Ephemeral });
    } catch (error) {
      release();
      throw error;
    }

    const timer = setTimeout(async () => {
      try {
        await interaction.followUp({ content, allowedMentions: { parse: [] } });
      } catch (error) {
        ctx.log.message('say_later_failed', { interactionId: interaction.id, userId, error: String(error) });
        console.warn(`Delayed message failed: ${(error as Error).message}`);
      } finally {
        release();
      }
    }, seconds * 1000);
    timer.unref(); // never keep the process alive just for a pending line
  },
};

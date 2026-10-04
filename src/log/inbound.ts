import { Events, type Client } from 'discord.js';
import type { Logger } from './logger';

/**
 * Logs every message in a DM between the bot and a user, in both directions.
 * This is how replies to a message the bot sent on its own arrive: they show up as ordinary
 * messages in that DM channel. It cannot see DMs between two other people.
 */
export function logDirectMessages(client: Client, log: Logger): void {
  client.on(Events.MessageCreate, (message) => {
    if (!message.channel.isDMBased()) return;
    const outgoing = message.author.id === client.user?.id;
    // The human on the other end: the recipient of our message, or the author of theirs.
    const userId = outgoing ? (message.channel.isDMBased() && 'recipientId' in message.channel ? message.channel.recipientId : null) : message.author.id;
    log.message('dm_message', {
      direction: outgoing ? 'out' : 'in',
      messageId: message.id,
      channelId: message.channelId,
      userId,
      username: outgoing ? undefined : message.author.username,
      content: log.text(message.content),
      attachments: [...message.attachments.values()].map((a) => a.name),
    });
  });
}

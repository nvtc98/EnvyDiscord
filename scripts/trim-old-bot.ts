// One-time: trim the OLD (retired) bot's global slash commands down to just /say.
// Reads OLD_DISCORD_TOKEN / OLD_DISCORD_CLIENT_ID from .env (the retiring bot's own
// credentials), NOT the active DISCORD_TOKEN. Run with:
//   npx tsx --env-file=.env scripts/trim-old-bot.ts
// After this, the old bot still answers /say if it is running; you can then stop its process.
import { REST, Routes } from 'discord.js';
import { sayCommand } from '../src/discord/commands/say';

const token = process.env.OLD_DISCORD_TOKEN?.trim();
const clientId = process.env.OLD_DISCORD_CLIENT_ID?.trim();

if (!token || !clientId) {
  console.error('OLD_DISCORD_TOKEN and OLD_DISCORD_CLIENT_ID must be set in .env.');
  process.exit(1);
}

const rest = new REST().setToken(token);
const body = [sayCommand.data.toJSON()];

await rest.put(Routes.applicationCommands(clientId), { body });
console.log(`Old bot (app ${clientId}) now has exactly ${body.length} global command: /say. All other commands removed.`);

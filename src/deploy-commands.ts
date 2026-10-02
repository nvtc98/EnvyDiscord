import { REST, Routes } from 'discord.js';
import { requireEnv } from './config';
import { commands } from './discord/commands';

const rest = new REST().setToken(requireEnv('DISCORD_TOKEN'));
const clientId = requireEnv('DISCORD_CLIENT_ID');
const guildId = process.env.DEV_GUILD_ID?.trim();
const names = commands.map((c) => `/${c.data.name}`).join(', ');

if (guildId) {
  // Guild commands appear instantly and leave the app's global commands untouched.
  // integration_types/contexts only apply to global commands, so they are left out here.
  const body = commands.map((c) => {
    const { integration_types, contexts, ...guildSafe } = c.data.toJSON();
    return guildSafe;
  });
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
  console.log(`Registered ${body.length} commands for server ${guildId} (server only, not usable in DMs): ${names}`);
} else {
  const body = commands.map((c) => c.data.toJSON());
  await rest.put(Routes.applicationCommands(clientId), { body });
  console.log(`Registered ${body.length} global commands (usable in DMs too): ${names}`);
}

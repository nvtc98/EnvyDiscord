import { fileURLToPath } from 'node:url';
import { Client, Events, GatewayIntentBits, MessageFlags, type Interaction } from 'discord.js';
import { CARDS, CARD_INDEX } from './data/cards';
import { JsonPlayerRepo } from './db/json-repo';
import { loadConfig } from './config';
import type { AppContext } from './discord/command';
import { commandMap } from './discord/commands';

const config = loadConfig();
const repo = await JsonPlayerRepo.open(config.dataFile);
// Loaded lazily so a missing native canvas build only disables images instead of crashing the bot.
let images: AppContext['images'] = null;
try {
  const { createImageRenderer } = await import('./render/renderer');
  images = await createImageRenderer({ assetsDir: fileURLToPath(new URL('../assets', import.meta.url)), cards: CARDS });
  console.log('Image rendering enabled');
} catch (error) {
  console.warn(`Image rendering unavailable, falling back to text embeds: ${(error as Error).message}`);
}

const ctx: AppContext = {
  repo,
  cards: CARDS,
  cardIndex: CARD_INDEX,
  rng: Math.random,
  timezone: config.timezone,
  images,
};

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function handle(interaction: Interaction): Promise<void> {
  if (interaction.isChatInputCommand()) {
    await commandMap.get(interaction.commandName)?.execute(interaction, ctx);
  } else if (interaction.isAutocomplete()) {
    await commandMap.get(interaction.commandName)?.autocomplete?.(interaction, ctx);
  } else if (interaction.isMessageComponent()) {
    const [name] = interaction.customId.split(':');
    await commandMap.get(name)?.component?.(interaction, ctx);
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await handle(interaction);
  } catch (error) {
    console.error('Error while handling interaction:', error);
    if (interaction.isRepliable()) {
      const message = { content: '⚠️ Something went wrong, please try again.', flags: MessageFlags.Ephemeral } as const;
      await (interaction.replied || interaction.deferred ? interaction.followUp(message) : interaction.reply(message)).catch(() => undefined);
    }
  }
});

client.once(Events.ClientReady, (ready) => console.log(`Online as ${ready.user.tag}`));

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal}: saving data and shutting down...`);
  await client.destroy();
  await repo.flush();
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await client.login(config.token);

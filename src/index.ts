import { fileURLToPath } from "node:url";
import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  type Interaction,
} from "discord.js";
import { CARDS, CARD_INDEX } from "./data/cards";
import { JsonPlayerRepo } from "./db/json-repo";
import { loadConfig } from "./config";
import type { AppContext } from "./discord/command";
import { commandMap } from "./discord/commands";
import { notifyInteractionError } from "./discord/interaction-errors";
import { describeInteraction, instrument } from "./log/instrument";
import { logDirectMessages } from "./log/inbound";
import { JsonlLogger } from "./log/logger";

const config = loadConfig();
const repo = await JsonPlayerRepo.open(config.dataFile);
const log = new JsonlLogger(config.logDir, config.timezone, config.logContent);
// Loaded lazily so a missing native canvas build only disables images instead of crashing the bot.
let images: AppContext["images"] = null;
try {
  const { createImageRenderer } = await import("./render/renderer");
  images = await createImageRenderer({
    assetsDir: fileURLToPath(new URL("../assets", import.meta.url)),
  });
  console.log("Image rendering enabled");
} catch (error) {
  console.warn(
    `Image rendering unavailable, falling back to text embeds: ${(error as Error).message}`,
  );
}

const ctx: AppContext = {
  repo,
  cards: CARDS,
  cardIndex: CARD_INDEX,
  rng: Math.random,
  timezone: config.timezone,
  images,
  log,
};

// DirectMessages lets the bot see replies in its own DMs (not a privileged intent);
// Partials.Channel is required because DM channels are not cached when the bot starts.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel],
});
logDirectMessages(client, log);

async function handle(interaction: Interaction): Promise<void> {
  const received = describeInteraction(interaction, log);
  if (received) log.message("interaction", received);
  if (interaction.isRepliable() && !interaction.isAutocomplete())
    instrument(interaction, log);

  if (interaction.isChatInputCommand()) {
    await commandMap.get(interaction.commandName)?.execute(interaction, ctx);
  } else if (interaction.isAutocomplete()) {
    await commandMap
      .get(interaction.commandName)
      ?.autocomplete?.(interaction, ctx);
  } else if (interaction.isMessageComponent()) {
    const [name] = interaction.customId.split(":");
    await commandMap.get(name)?.component?.(interaction, ctx);
  } else if (interaction.isModalSubmit()) {
    const [name] = interaction.customId.split(":");
    await commandMap.get(name)?.modal?.(interaction, ctx);
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await handle(interaction);
  } catch (error) {
    console.error("Error while handling interaction:", error);
    log.message("error", {
      interactionId: interaction.id,
      userId: interaction.user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    if (interaction.isRepliable()) {
      const message = {
        content: "⚠️ Something hath gone amiss. I bid thee try once more.",
        flags: MessageFlags.Ephemeral,
      } as const;
      // notifyInteractionError acknowledges at most once and swallows benign ack errors
      // (10062/40060), so a primary ack failure is never amplified into a second blind reply.
      await notifyInteractionError(interaction, message, log).catch(
        () => undefined,
      );
    }
  }
});

client.once(Events.ClientReady, (ready) =>
  console.log(`Online as ${ready.user.tag}`),
);

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal}: saving data and shutting down...`);
  await client.destroy();
  await Promise.all([repo.flush(), log.flush()]);
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

await client.login(config.token);

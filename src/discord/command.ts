import {
  ApplicationIntegrationType,
  InteractionContextType,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
  type RESTPostAPIApplicationCommandsJSONBody,
} from 'discord.js';
import type { PlayerRepo } from '../db/repository';
import type { CardDef } from '../engine/types';
import type { ImageRenderer } from '../render/renderer';
import type { Rng } from '../util/rng';

export interface AppContext {
  repo: PlayerRepo;
  cards: CardDef[];
  cardIndex: Map<string, CardDef>;
  rng: Rng;
  timezone: string;
  /** Null when image rendering is unavailable; commands then fall back to text embeds. */
  images: ImageRenderer | null;
}

export interface Command {
  data: { name: string; toJSON(): RESTPostAPIApplicationCommandsJSONBody };
  execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction, ctx: AppContext): Promise<void>;
  /** Buttons / select menus whose customId starts with `<command name>:`. */
  component?(interaction: MessageComponentInteraction, ctx: AppContext): Promise<void>;
}

/** Slash command usable in servers, in DMs with the bot, and in any DM/group DM (User Install). */
export function slash(name: string, description: string): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    );
}

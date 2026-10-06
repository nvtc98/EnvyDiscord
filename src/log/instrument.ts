import {
  DiscordAPIError,
  MessageFlags,
  type APIEmbed,
  type Interaction,
  type RepliableInteraction,
} from "discord.js";
import { isBenignAckError } from "../discord/interaction-errors";
import type { Logger } from "./logger";

const RESPONSE_METHODS = ["reply", "update", "followUp", "editReply"] as const;

/** A compact, log-friendly summary of a message payload (text, embed titles, attachment names). */
export function describePayload(
  payload: unknown,
  log: Logger,
): Record<string, unknown> {
  if (typeof payload === "string")
    return {
      content: log.text(payload),
      embeds: [],
      files: [],
      ephemeral: false,
    };
  if (!payload || typeof payload !== "object") return {};

  const p = payload as {
    content?: string;
    embeds?: unknown[];
    files?: unknown[];
    flags?: unknown;
  };
  const embeds = (p.embeds ?? []).map((embed) => {
    const json: APIEmbed =
      typeof (embed as { toJSON?: unknown }).toJSON === "function"
        ? (embed as { toJSON(): APIEmbed }).toJSON()
        : (embed as APIEmbed);
    return {
      title: json.title,
      description: log.text(json.description),
      fields: json.fields?.length ?? 0,
    };
  });
  const files = (p.files ?? []).map(
    (file) => (file as { name?: string }).name ?? "file",
  );
  const ephemeral =
    typeof p.flags === "number" && (p.flags & MessageFlags.Ephemeral) !== 0;
  return { content: log.text(p.content), embeds, files, ephemeral };
}

/**
 * Wraps the reply methods of one interaction so everything the bot says in response is logged,
 * without each command having to log its own replies.
 */
export function instrument(
  interaction: RepliableInteraction,
  log: Logger,
): void {
  const target = interaction as unknown as Record<string, unknown>;
  for (const method of RESPONSE_METHODS) {
    const original = target[method];
    if (typeof original !== "function") continue; // e.g. `update` only exists on component interactions
    target[method] = async (payload: unknown) => {
      let result: unknown;
      try {
        result = await original.call(interaction, payload);
      } catch (error) {
        // A benign ack failure (10062/40060) cannot be recovered from; log it and swallow it so it
        // does not bubble into the top-level catch and trigger a second acknowledgement.
        if (isBenignAckError(error)) {
          log.message("error", {
            interactionId: interaction.id,
            method,
            userId: interaction.user.id,
            channelId: interaction.channelId,
            error: `benign ack error swallowed: ${(error as DiscordAPIError).code}`,
          });
          return undefined;
        }
        throw error;
      }
      log.message("bot_response", {
        interactionId: interaction.id,
        method,
        userId: interaction.user.id,
        channelId: interaction.channelId,
        ...describePayload(payload, log),
      });
      return result;
    };
  }
}

/** What the bot received: a command (with its options) or a button/menu click. */
export function describeInteraction(
  interaction: Interaction,
  log: Logger,
): Record<string, unknown> | null {
  const base = {
    interactionId: interaction.id,
    userId: interaction.user.id,
    username: interaction.user.username,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    context: interaction.context,
  };
  if (interaction.isChatInputCommand()) {
    const options = interaction.options.data.map((o) =>
      log.logContent ? { name: o.name, value: o.value } : { name: o.name },
    );
    return { ...base, kind: "command", name: interaction.commandName, options };
  }
  if (interaction.isMessageComponent()) {
    return { ...base, kind: "component", customId: interaction.customId };
  }
  if (interaction.isModalSubmit()) {
    const fields = [...(interaction.fields?.fields?.values() ?? [])].map((f) =>
      log.logContent && "value" in f
        ? { name: f.customId, value: f.value }
        : { name: f.customId },
    );
    return { ...base, kind: "modal", customId: interaction.customId, fields };
  }
  return null; // autocomplete keystrokes would only be noise
}

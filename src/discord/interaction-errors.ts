import {
  DiscordAPIError,
  RESTJSONErrorCodes,
  type RepliableInteraction,
} from "discord.js";
import type { Logger } from "../log/logger";

/**
 * Discord ack errors that are safe to swallow: the interaction token is already unknown/expired
 * (10062) or the interaction was already acknowledged (40060). Neither can be recovered from, and
 * retrying only amplifies the failure into a storm of secondary errors.
 */
export const BENIGN_ACK_CODES: readonly number[] = [
  RESTJSONErrorCodes.UnknownInteraction,
  RESTJSONErrorCodes.InteractionHasAlreadyBeenAcknowledged,
];

/** True when the error is a DiscordAPIError whose code is one of the benign ack codes above. */
export function isBenignAckError(error: unknown): boolean {
  return (
    error instanceof DiscordAPIError && BENIGN_ACK_CODES.includes(error.code as number)
  );
}

/**
 * Notify the user that something went wrong, acknowledging the interaction at most once.
 *
 * Only sends a fresh `reply` when the interaction has NOT been acknowledged (`!replied && !deferred`),
 * so a primary ack failure never triggers a second blind `reply`. If the interaction was already
 * acknowledged we attempt a `followUp` instead. Any benign ack error (10062/40060) from the notify
 * attempt is logged and swallowed rather than rethrown, so it cannot bubble back into the caller.
 */
export async function notifyInteractionError(
  interaction: RepliableInteraction,
  message: Parameters<RepliableInteraction["reply"]>[0],
  log: Logger,
): Promise<void> {
  const acknowledged = interaction.replied || interaction.deferred;
  try {
    if (!acknowledged) {
      await interaction.reply(message);
    } else {
      await interaction.followUp(message);
    }
  } catch (error) {
    if (isBenignAckError(error)) {
      log.message("error", {
        interactionId: interaction.id,
        userId: interaction.user.id,
        error: `benign ack error swallowed during notify: ${(error as DiscordAPIError).code}`,
      });
      return;
    }
    throw error;
  }
}

import { MessageFlags, RESTJSONErrorCodes } from "discord.js";
import { describe, expect, it } from "vitest";
import {
  isBenignAckError,
  notifyInteractionError,
} from "../src/discord/interaction-errors";
import {
  buttonInteraction,
  discordApiError,
  slashInteraction,
  spyLogger,
} from "./discord-helpers";

const NOTICE = {
  content: "⚠️ Something hath gone amiss. I bid thee try once more.",
  flags: MessageFlags.Ephemeral,
} as const;

describe("isBenignAckError", () => {
  it("is true for 10062 Unknown interaction", () => {
    expect(
      isBenignAckError(discordApiError(RESTJSONErrorCodes.UnknownInteraction)),
    ).toBe(true);
  });

  it("is true for 40060 already acknowledged", () => {
    expect(
      isBenignAckError(
        discordApiError(
          RESTJSONErrorCodes.InteractionHasAlreadyBeenAcknowledged,
        ),
      ),
    ).toBe(true);
  });

  it("is false for other DiscordAPIError codes", () => {
    expect(
      isBenignAckError(
        discordApiError(RESTJSONErrorCodes.CannotSendMessagesToThisUser),
      ),
    ).toBe(false);
  });

  it("is false for a plain Error", () => {
    expect(isBenignAckError(new Error("boom"))).toBe(false);
  });
});

describe("notifyInteractionError", () => {
  it("does NOT re-acknowledge after a successful defer (throw-after-defer)", async () => {
    const log = spyLogger();
    const interaction = slashInteraction("1");
    // Simulate the command having deferred successfully before its later work threw.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    expect(interaction.deferred).toBe(true);

    await notifyInteractionError(interaction as never, NOTICE, log);

    // The interaction is already acknowledged, so no second reply is attempted.
    expect(interaction.reply).toHaveBeenCalledTimes(0);
    expect(interaction.followUp).toHaveBeenCalledTimes(1);
  });

  it("swallows a 40060 from the followUp instead of rethrowing", async () => {
    const log = spyLogger();
    const interaction = slashInteraction("1");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    interaction.followUp.mockRejectedValueOnce(
      discordApiError(RESTJSONErrorCodes.InteractionHasAlreadyBeenAcknowledged),
    );

    await expect(
      notifyInteractionError(interaction as never, NOTICE, log),
    ).resolves.toBeUndefined();
    expect(interaction.reply).toHaveBeenCalledTimes(0);
  });

  it("replies exactly once when the interaction was never acknowledged (failed defer)", async () => {
    const log = spyLogger();
    // deferReply rejects with 10062, leaving replied/deferred false.
    const interaction = slashInteraction("1", {}, "1", {
      failDefer: RESTJSONErrorCodes.UnknownInteraction,
    });
    await expect(
      interaction.deferReply({ flags: MessageFlags.Ephemeral }),
    ).rejects.toThrow();
    expect(interaction.deferred).toBe(false);
    expect(interaction.replied).toBe(false);

    await notifyInteractionError(interaction as never, NOTICE, log);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledTimes(0);
  });

  it("swallows a 10062 from the reply on the failed-defer path", async () => {
    const log = spyLogger();
    const interaction = slashInteraction("1", {}, "1", {
      failDefer: RESTJSONErrorCodes.UnknownInteraction,
    });
    await interaction
      .deferReply({ flags: MessageFlags.Ephemeral })
      .catch(() => undefined);
    interaction.reply.mockRejectedValueOnce(
      discordApiError(RESTJSONErrorCodes.UnknownInteraction),
    );

    await expect(
      notifyInteractionError(interaction as never, NOTICE, log),
    ).resolves.toBeUndefined();
    expect(interaction.reply).toHaveBeenCalledTimes(1);
  });

  it("rethrows a non-benign error from the notify attempt", async () => {
    const log = spyLogger();
    const interaction = slashInteraction("1");
    interaction.reply.mockRejectedValueOnce(new Error("network down"));

    await expect(
      notifyInteractionError(interaction as never, NOTICE, log),
    ).rejects.toThrow("network down");
  });

  it("acknowledges a component interaction exactly once (gate path)", async () => {
    const log = spyLogger();
    const interaction = buttonInteraction("1", "story:gate:begin");
    // The gate acknowledges with update first.
    await interaction.update({ components: [] });
    expect(interaction.replied).toBe(true);

    await notifyInteractionError(interaction as never, NOTICE, log);

    // Already acknowledged by update, so no reply — at most one followUp.
    expect(interaction.reply).toHaveBeenCalledTimes(0);
    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    expect(interaction.update).toHaveBeenCalledTimes(1);
  });
});

import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import { vi } from "vitest";
import { CARDS, CARD_INDEX } from "../src/data/cards";
import type { PlayerRepo } from "../src/db/repository";
import type { AppContext } from "../src/discord/command";
import { createPlayer, type Player } from "../src/game/player";
import { nullLogger, type Logger } from "../src/log/logger";
import type { ImageRenderer } from "../src/render/renderer";
import { mulberry32 } from "../src/util/rng";

export class MemoryRepo implements PlayerRepo {
  players = new Map<string, Player>();
  get(id: string): Player {
    return structuredClone(this.players.get(id) ?? createPlayer(id));
  }
  async save(player: Player): Promise<void> {
    this.players.set(player.id, structuredClone(player));
  }
  all(): Player[] {
    return [...this.players.values()].map((p) => structuredClone(p));
  }
  async flush(): Promise<void> {}
}

/** A fake DM channel: `send` records the payload and returns a unique message id. */
export function dmChannel() {
  const sent: any[] = [];
  let next = 1;
  const send = vi.fn(async (payload: unknown) => {
    sent.push(payload);
    return { id: `dm-${next++}` };
  });
  return { send, sent };
}

/** A button press on a DM message. `messageId` is the id of the message the button lived on. */
export function dmButtonInteraction(
  userId: string,
  customId: string,
  messageId: string,
  channel?: ReturnType<typeof dmChannel>,
) {
  return {
    ...buttonInteraction(userId, customId),
    message: { id: messageId },
    channel,
  };
}

export interface LogEntry {
  stream: "game" | "messages";
  type: string;
  data: Record<string, unknown>;
}

export function spyLogger(): Logger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return {
    ...nullLogger,
    game: (type, data = {}) =>
      void entries.push({ stream: "game", type, data }),
    message: (type, data = {}) =>
      void entries.push({ stream: "messages", type, data }),
    entries,
  };
}

export function makeCtx(
  seed = 1,
  images: ImageRenderer | null = null,
): AppContext & { repo: MemoryRepo; log: ReturnType<typeof spyLogger> } {
  return {
    repo: new MemoryRepo(),
    cards: CARDS,
    cardIndex: CARD_INDEX,
    rng: mulberry32(seed),
    timezone: "UTC",
    images,
    log: spyLogger(),
  };
}

/** Gives a player every card at the given tier. */
export function ownEverything(ctx: AppContext, userId: string, tier = 1): void {
  const player = ctx.repo.get(userId);
  for (const c of ctx.cards) player.cards[c.id] = tier;
  void ctx.repo.save(player);
}

/** A fake slash interaction. `ownerId` is the account the fake Discord application belongs to (the caller by default). */
export function slashInteraction(
  userId: string,
  options: Record<string, string | boolean | null> = {},
  ownerId: string = userId,
  opts: { dm?: ReturnType<typeof dmChannel> | null } = {},
) {
  const reply = vi.fn(async (_payload: unknown) => undefined);
  // `dm` is the channel user.createDM() resolves to; pass dm: null to simulate closed DMs.
  const dm = opts.dm === undefined ? dmChannel() : opts.dm;
  const createDM = vi.fn(async () => {
    if (!dm) {
      throw new DiscordAPIError(
        {
          code: RESTJSONErrorCodes.CannotSendMessagesToThisUser,
          message: "Cannot send messages to this user",
        } as never,
        RESTJSONErrorCodes.CannotSendMessagesToThisUser,
        403,
        "POST",
        "",
        {},
      );
    }
    return dm;
  });
  // A fake user the slash command can resolve from a `user` option (plus the one invoking it).
  const makeUser = (id: string) => ({
    id,
    username: `user${id}`,
    displayName: `User ${id}`,
    bot: false,
    createDM,
    displayAvatarURL: (_opts?: unknown) => `https://cdn.example/${id}.png`,
  });
  return {
    user: makeUser(userId),
    dm,
    options: {
      getString: (name: string) =>
        typeof options[name] === "string" ? (options[name] as string) : null,
      getBoolean: (name: string) =>
        typeof options[name] === "boolean" ? (options[name] as boolean) : null,
      // A `user` option value is a user id string in these tests; required=true throws when absent.
      getUser: (name: string, required?: boolean) => {
        const value = options[name];
        if (typeof value === "string") return makeUser(value);
        if (required) throw new Error(`missing required user option: ${name}`);
        return null;
      },
      getSubcommand: () =>
        typeof options.subcommand === "string"
          ? (options.subcommand as string)
          : null,
    },
    client: {
      application: { fetch: async () => ({ owner: { id: ownerId } }) },
    },
    reply,
  };
}

export function buttonInteraction(userId: string, customId: string) {
  return {
    user: { id: userId, username: `user${userId}` },
    customId,
    isButton: () => true,
    isStringSelectMenu: () => false,
    update: vi.fn(async (_payload: unknown) => undefined),
    reply: vi.fn(async (_payload: unknown) => undefined),
  };
}

/** The player has taken their first cards, so /daily is open. */
export function unlockDaily(ctx: AppContext, userId: string): void {
  const player = ctx.repo.get(userId);
  player.story = {
    node: "prologue_end",
    name: null,
    isEye: null,
    knowsTribe: null,
    nameAttempts: [],
    pendingName: null,
    notice: null,
    pack: null,
    starterClaimed: true,
    liveMessageId: null,
  };
  void ctx.repo.save(player);
}

/** A button press that opens a form. */
export function buttonWithModal(userId: string, customId: string) {
  return {
    ...buttonInteraction(userId, customId),
    showModal: vi.fn(async (_modal: unknown) => undefined),
  };
}

/** A submitted form. `fromMessage` is true when the form was opened from a message's button, as the story does. */
export function modalInteraction(
  userId: string,
  customId: string,
  text: string,
  fromMessage = true,
) {
  return {
    user: { id: userId, username: `user${userId}` },
    customId,
    fields: { getTextInputValue: (_id: string) => text },
    isFromMessage: () => fromMessage,
    update: vi.fn(async (_payload: unknown) => undefined),
    reply: vi.fn(async (_payload: unknown) => undefined),
  };
}

export function selectInteraction(
  userId: string,
  customId: string,
  values: string[],
) {
  return {
    ...buttonInteraction(userId, customId),
    isButton: () => false,
    isStringSelectMenu: () => true,
    values,
  };
}

type Json = Record<string, any>;

/** The component rows of a payload as plain JSON. */
export function rows(payload: { components?: { toJSON(): Json }[] }): Json[] {
  return (payload.components ?? []).map((r) => r.toJSON());
}

export const embedOf = (payload: { embeds?: { toJSON(): Json }[] }): Json =>
  payload.embeds![0].toJSON();

/** The payload passed to the first call of a mock. */
export const firstPayload = (fn: ReturnType<typeof vi.fn>): any =>
  fn.mock.calls[0][0];
export const lastPayload = (fn: ReturnType<typeof vi.fn>): any =>
  fn.mock.calls.at(-1)![0];

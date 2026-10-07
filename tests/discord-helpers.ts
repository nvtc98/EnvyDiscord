import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import { vi } from "vitest";
import {
  CARDS,
  CARD_INDEX,
  COLLECTIBLE_CARDS,
  COLLECTIBLE_CARD_INDEX,
} from "../src/data/cards";
import {
  DEFAULT_VARIANT,
  variantOrder,
  type VariantId,
} from "../src/data/variants";
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

/**
 * A fake DM channel: `send` records the payload and returns a unique message id. `sendTyping` records
 * each typing beat (push "typing" onto `events` and bump `typingCount`) so tests can assert ordering
 * against sends; `events` interleaves "typing" markers with the sent payloads in call order.
 */
export function dmChannel() {
  const sent: any[] = [];
  const events: any[] = [];
  // Each sent payload keyed by the id send() returned, so clearComponents can strip buttons off the
  // SAME object instances the `sent` array (and the live()/buttons() helpers) read from.
  const byId = new Map<string, any>();
  // The reverse map: the id send() returned for a given payload object, so a test can press the exact
  // message the handler recorded as live (needed by the gate/scene stale guards).
  const idByPayload = new Map<any, string>();
  let typingCount = 0;
  let next = 1;
  // Overlap seam: when paused, each send() records its payload immediately but withholds its resolution
  // (the `{ id }`) until flushSends() is called. This lets a test start a SECOND handling while the
  // first deliverScene is still awaiting its paced sends, modelling a redelivered/duplicate interaction
  // the way production times out. Default (unpaused) resolves immediately so existing tests are unchanged.
  let paused = false;
  const pending: Array<() => void> = [];
  const send = vi.fn((payload: any) => {
    const id = `dm-${next++}`;
    sent.push(payload);
    events.push(payload);
    byId.set(id, payload);
    idByPayload.set(payload, id);
    if (!paused) return Promise.resolve({ id });
    return new Promise<{ id: string }>((resolve) => {
      pending.push(() => resolve({ id }));
    });
  });
  const sendTyping = vi.fn(async () => {
    typingCount++;
    events.push("typing");
  });
  // Mirrors production: editing a prior message to { components: [] }. Mutates the stored payload so a
  // later live()/buttons() scan sees the buttons gone. A missing id is a no-op (benign in production).
  const clearComponents = vi.fn(async (id: string) => {
    const m = byId.get(id);
    if (m) m.components = [];
  });
  return {
    send,
    sendTyping,
    clearComponents,
    sent,
    events,
    /** The current components of the message with this id (as sent/edited), or undefined if unknown. */
    componentsOf: (id: string) => byId.get(id)?.components,
    /** The id send() returned for a given sent payload object (the message a test should press). */
    idOf: (payload: any): string => {
      const id = idByPayload.get(payload);
      if (id === undefined)
        throw new Error("payload was never sent on this DM");
      return id;
    },
    /** Hold every subsequent send()'s resolution until flushSends(), to model overlapping handlings. */
    pauseSends: () => {
      paused = true;
    },
    /** Resolve all withheld sends and resume immediate resolution. */
    flushSends: () => {
      paused = false;
      while (pending.length) pending.shift()!();
    },
    get typingCount() {
      return typingCount;
    },
  };
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
    collectibleCards: COLLECTIBLE_CARDS,
    collectibleCardIndex: COLLECTIBLE_CARD_INDEX,
    rng: mulberry32(seed),
    timezone: "UTC",
    images,
    log: spyLogger(),
  };
}

/** Gives a player every collectible card, each owning only the given variant (metal by default), active = that variant. */
export function ownEverything(
  ctx: AppContext,
  userId: string,
  variant: VariantId = DEFAULT_VARIANT,
): void {
  const player = ctx.repo.get(userId);
  for (const c of ctx.collectibleCards)
    player.cards[c.id] = { variants: [variant], active: variant };
  void ctx.repo.save(player);
}

/** Gives a player every collectible card owning every variant (a fully complete collection). */
export function ownEveryVariant(ctx: AppContext, userId: string): void {
  const player = ctx.repo.get(userId);
  const all = variantOrder();
  for (const c of ctx.collectibleCards)
    player.cards[c.id] = { variants: [...all], active: all[0] };
  void ctx.repo.save(player);
}

/** A fake slash interaction. `ownerId` is the account the fake Discord application belongs to (the caller by default). */
export function slashInteraction(
  userId: string,
  options: Record<string, string | boolean | null> = {},
  ownerId: string = userId,
  opts: {
    dm?: ReturnType<typeof dmChannel> | null;
    failDefer?: number;
  } = {},
) {
  // `replied`/`deferred` track the real discord.js acknowledgement flags so the top-level catch can
  // decide whether to reply or followUp. A successful deferReply flips `deferred`; a failed one leaves
  // both false (as real discord.js does when the callback POST throws).
  const flags = { replied: false, deferred: false };
  const reply = vi.fn(async (_payload: unknown) => {
    flags.replied = true;
    return undefined;
  });
  // Commands may defer first and then editReply (needed when work exceeds Discord's 3s window).
  // editReply shares the `reply` spy so assertions on the bot's response work whichever path a command takes.
  const deferReply = vi.fn(async (_payload?: unknown) => {
    if (opts.failDefer !== undefined) throw discordApiError(opts.failDefer);
    flags.deferred = true;
    return undefined;
  });
  const editReply = reply;
  const followUp = vi.fn(async (_payload: unknown) => {
    flags.replied = true;
    return undefined;
  });
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
    isRepliable: () => true,
    get replied() {
      return flags.replied;
    },
    get deferred() {
      return flags.deferred;
    },
    reply,
    deferReply,
    editReply,
    followUp,
  };
}

export function buttonInteraction(
  userId: string,
  customId: string,
  opts: { failUpdate?: number } = {},
) {
  // `replied`/`deferred` mirror discord.js: a successful `update` acknowledges the component
  // interaction (sets `replied`); a failed one leaves both false.
  const flags = { replied: false, deferred: false };
  const update = vi.fn(async (_payload: unknown) => {
    if (opts.failUpdate !== undefined) throw discordApiError(opts.failUpdate);
    flags.replied = true;
    return undefined;
  });
  const followUp = vi.fn(async (_payload: unknown) => undefined);
  return {
    user: { id: userId, username: `user${userId}` },
    customId,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isRepliable: () => true,
    get replied() {
      return flags.replied;
    },
    get deferred() {
      return flags.deferred;
    },
    update,
    // The animated end-of-turn path acknowledges with `update`, then edits in place with `editReply`.
    editReply: vi.fn(async (_payload: unknown) => undefined),
    reply: vi.fn(async (_payload: unknown) => undefined),
    followUp,
  };
}

/** The player has taken their first cards, so /daily is open. */
export function unlockDaily(ctx: AppContext, userId: string): void {
  const player = ctx.repo.get(userId);
  player.story = {
    node: "chapter_end",
    name: null,
    isEye: null,
    knowsTribe: null,
    nameAttempts: [],
    pendingName: null,
    notice: null,
    pack: null,
    starterClaimed: true,
    liveMessageId: null,
    chapter: null,
    battle: null,
    caveWon: false,
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

/** Builds a DiscordAPIError with the given code, mirroring the construction used in createDM. */
export function discordApiError(
  code: number,
  message = "test",
): DiscordAPIError {
  return new DiscordAPIError(
    { code, message } as never,
    code as never,
    code === RESTJSONErrorCodes.UnknownInteraction ? 404 : 400,
    "POST",
    "",
    {},
  );
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

import { vi } from 'vitest';
import { CARDS, CARD_INDEX } from '../src/data/cards';
import type { PlayerRepo } from '../src/db/repository';
import type { AppContext } from '../src/discord/command';
import { createPlayer, type Player } from '../src/game/player';
import { nullLogger, type Logger } from '../src/log/logger';
import type { ImageRenderer } from '../src/render/renderer';
import { mulberry32 } from '../src/util/rng';

export class MemoryRepo implements PlayerRepo {
  players = new Map<string, Player>();
  get(id: string): Player {
    return structuredClone(this.players.get(id) ?? createPlayer(id));
  }
  async save(player: Player): Promise<void> {
    this.players.set(player.id, structuredClone(player));
  }
  async flush(): Promise<void> {}
}

export interface LogEntry {
  stream: 'game' | 'messages';
  type: string;
  data: Record<string, unknown>;
}

export function spyLogger(): Logger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return {
    ...nullLogger,
    game: (type, data = {}) => void entries.push({ stream: 'game', type, data }),
    message: (type, data = {}) => void entries.push({ stream: 'messages', type, data }),
    entries,
  };
}

export function makeCtx(seed = 1, images: ImageRenderer | null = null): AppContext & { repo: MemoryRepo; log: ReturnType<typeof spyLogger> } {
  return { repo: new MemoryRepo(), cards: CARDS, cardIndex: CARD_INDEX, rng: mulberry32(seed), timezone: 'UTC', images, log: spyLogger() };
}

/** Gives a player every card at the given tier. */
export function ownEverything(ctx: AppContext, userId: string, tier = 1): void {
  const player = ctx.repo.get(userId);
  for (const c of ctx.cards) player.cards[c.id] = tier;
  void ctx.repo.save(player);
}

export function slashInteraction(userId: string, options: Record<string, string | null> = {}) {
  const reply = vi.fn(async (_payload: unknown) => undefined);
  return {
    user: { id: userId, username: `user${userId}`, displayName: `User ${userId}` },
    options: { getString: (name: string) => options[name] ?? null },
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

export function selectInteraction(userId: string, customId: string, values: string[]) {
  return { ...buttonInteraction(userId, customId), isButton: () => false, isStringSelectMenu: () => true, values };
}

type Json = Record<string, any>;

/** The component rows of a payload as plain JSON. */
export function rows(payload: { components?: { toJSON(): Json }[] }): Json[] {
  return (payload.components ?? []).map((r) => r.toJSON());
}

export const embedOf = (payload: { embeds?: { toJSON(): Json }[] }): Json => payload.embeds![0].toJSON();

/** The payload passed to the first call of a mock. */
export const firstPayload = (fn: ReturnType<typeof vi.fn>): any => fn.mock.calls[0][0];
export const lastPayload = (fn: ReturnType<typeof vi.fn>): any => fn.mock.calls.at(-1)![0];

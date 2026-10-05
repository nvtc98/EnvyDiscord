import type { CardDef } from "../engine/types";
import { shuffle, type Rng } from "../util/rng";
import { grantCard, receivable, type GrantResult, type Player } from "./player";

export const PACK_SIZE = 3;
export const DAILY_COINS = 30;

/** `size` different cards chosen uniformly. */
export function drawPack(
  cards: readonly CardDef[],
  rng: Rng,
  size = PACK_SIZE,
): CardDef[] {
  return shuffle(cards, rng).slice(0, size);
}

/** YYYY-MM-DD in the given IANA timezone. */
export function todayKey(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}

export type DailyResult =
  | { ok: false; reason: "already-claimed" | "collection-complete" }
  | { ok: true; grants: GrantResult[]; coins: number };

/**
 * One pack per day, drawn from the cards the player can still receive (unowned, or missing at least one variant).
 * When every card owns every variant there is nothing to give, and the day is not used up.
 */
export function claimDaily(
  player: Player,
  cards: readonly CardDef[],
  today: string,
  rng: Rng,
): DailyResult {
  if (player.lastDaily === today)
    return { ok: false, reason: "already-claimed" };
  const pool = receivable(player, cards);
  if (pool.length === 0) return { ok: false, reason: "collection-complete" };

  const grants = drawPack(pool, rng).map((card) => grantCard(player, card));
  player.coins += DAILY_COINS;
  player.lastDaily = today;
  return { ok: true, grants, coins: DAILY_COINS };
}

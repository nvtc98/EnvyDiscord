import type { CardDef, Rarity } from '../engine/types';
import { pick, weightedPick, type Rng } from '../util/rng';
import { grantCard, type GrantResult, type Player } from './player';

export const PACK_SIZE = 3;
export const DAILY_COINS = 30;

const RARITY_WEIGHT: Record<Rarity, number> = { common: 60, rare: 28, epic: 10, legendary: 2 };

/** Draws `size` different cards, weighted by rarity. */
export function drawPack(cards: readonly CardDef[], rng: Rng, size = PACK_SIZE): CardDef[] {
  const pool = [...cards];
  const pack: CardDef[] = [];
  while (pack.length < size && pool.length > 0) {
    const rarities = [...new Set(pool.map((c) => c.rarity))];
    const rarity = weightedPick(
      rarities.map((r) => ({ item: r, weight: RARITY_WEIGHT[r] })),
      rng,
    );
    const card = pick(
      pool.filter((c) => c.rarity === rarity),
      rng,
    );
    pack.push(card);
    pool.splice(pool.indexOf(card), 1);
  }
  return pack;
}

/** YYYY-MM-DD in the given IANA timezone. */
export function todayKey(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}

export type DailyResult = { ok: false } | { ok: true; grants: GrantResult[]; coins: number };

export function claimDaily(player: Player, cards: readonly CardDef[], today: string, rng: Rng): DailyResult {
  if (player.lastDaily === today) return { ok: false };
  const grants = drawPack(cards, rng).map((card) => grantCard(player, card));
  player.coins += DAILY_COINS;
  player.lastDaily = today;
  return { ok: true, grants, coins: DAILY_COINS };
}

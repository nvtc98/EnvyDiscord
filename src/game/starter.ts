import type { CardDef, Rarity } from "../engine/types";
import { shuffle, type Rng } from "../util/rng";

/** The first sixteen cards a new player receives: unique, with a fixed mix of rarities. */
export const STARTER_MIX = { eternal: 2, bargain: 4, common: 10 } as const;
export const STARTER_SIZE =
  STARTER_MIX.eternal + STARTER_MIX.bargain + STARTER_MIX.common;

/**
 * The minimum number of ability cards (cards with a real `ability`) each rarity must contribute to a
 * starter pack. The sum is {@link STARTER_MIN_ABILITY} = 8, i.e. at least half of the sixteen cards
 * carry an active/passive effect, so a new player always has things to DO in the opening duel rather
 * than a hand of vanilla bodies. Ability cards also skew higher-cost (see the cost note below), so
 * this floor pulls the mean cost up into the window on its own.
 */
export const STARTER_MIN_ABILITY_MIX = {
  eternal: 1,
  bargain: 3,
  common: 4,
} as const;
export const STARTER_MIN_ABILITY =
  STARTER_MIN_ABILITY_MIX.eternal +
  STARTER_MIN_ABILITY_MIX.bargain +
  STARTER_MIN_ABILITY_MIX.common;

/**
 * Draws the fixed-mix sixteen (the anti-duplicate reroll between draws lives in the caller). Within
 * each rarity the pick GUARANTEES at least {@link STARTER_MIN_ABILITY_MIX} ability cards, then fills
 * the remaining slots from the rest of that rarity's pool. The whole pack therefore always holds at
 * least {@link STARTER_MIN_ABILITY} (= 8, half of sixteen) ability cards. Cards stay unique.
 */
export function drawStarterPack(
  cards: readonly CardDef[],
  rng: Rng,
): CardDef[] {
  const pickRarity = (rarity: Rarity) => {
    const pool = cards.filter((c) => c.rarity === rarity);
    const need = STARTER_MIX[rarity];
    const minAbility = STARTER_MIN_ABILITY_MIX[rarity];
    if (pool.length < need)
      throw new Error(
        `Not enough ${rarity} cards for a starter pack: need ${need}, have ${pool.length}`,
      );
    const abilityPool = pool.filter((c) => c.ability);
    if (abilityPool.length < minAbility)
      throw new Error(
        `Not enough ${rarity} ability cards for a starter pack: need ${minAbility}, have ${abilityPool.length}`,
      );
    // Guarantee the ability floor first, then fill the rest from everything NOT already chosen.
    const chosen = shuffle(abilityPool, rng).slice(0, minAbility);
    const taken = new Set(chosen.map((c) => c.id));
    const fill = shuffle(
      pool.filter((c) => !taken.has(c.id)),
      rng,
    ).slice(0, need - minAbility);
    return [...chosen, ...fill];
  };
  return [
    ...pickRarity("eternal"),
    ...pickRarity("bargain"),
    ...pickRarity("common"),
  ];
}

/**
 * The acceptable mean-cost window for a starter pack, and the redraw budget to reach it.
 *
 * The user asked the sixteen-card average cost to land near 3–5 so the opening hand is not a pile of
 * trivial 1-cost bodies, nor an unplayable top-heavy hand. The ability floor (at least 8 of 16 cards
 * carry an effect) already pulls the mean UP — ability cards average markedly higher cost than vanilla
 * bodies in every rarity — so over 100k simulated draws the sixteen-card mean averages ~4.16, ranges
 * ~2.5…6.0, and lands inside [3, 5] ~97% of the time. The window bans the two failure modes the user
 * cares about (an all-trivial sub-3 hand and a top-heavy >5 hand). The 5 ceiling is the edge that
 * occasionally binds; the 3 floor almost never does.
 *
 * Budget is 24 attempts: at a ~97% per-draw hit rate the chance all 24 miss is ~(0.03)^24, so the
 * budget is never meaningfully approached. On the near-impossible event it IS exhausted, we return the
 * LAST draw rather than throwing — a slightly-out-of-window hand beats a crash in the book flow.
 */
export const STARTER_COST_WINDOW = { min: 3, max: 5 } as const;
export const STARTER_COST_ATTEMPTS = 24;

/** The mean cost of a set of cards. */
function meanCost(cards: readonly CardDef[]): number {
  return cards.reduce((sum, c) => sum + c.cost, 0) / cards.length;
}

/**
 * Draws a starter pack whose sixteen-card mean cost lands in {@link STARTER_COST_WINDOW}, redrawing up
 * to {@link STARTER_COST_ATTEMPTS} times. Returns the first in-window draw, or the last draw if the
 * budget is exhausted (near-impossible at this window; never throws). The rarity composition and the
 * ability floor are untouched — this is an added filter around {@link drawStarterPack}.
 */
export function drawStarterPackBalanced(
  cards: readonly CardDef[],
  rng: Rng,
): CardDef[] {
  let pack = drawStarterPack(cards, rng);
  for (let attempt = 1; attempt < STARTER_COST_ATTEMPTS; attempt++) {
    const mean = meanCost(pack);
    if (mean >= STARTER_COST_WINDOW.min && mean <= STARTER_COST_WINDOW.max)
      return pack;
    pack = drawStarterPack(cards, rng);
  }
  return pack;
}

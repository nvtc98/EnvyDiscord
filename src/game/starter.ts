import type { CardDef } from "../engine/types";
import { shuffle, type Rng } from "../util/rng";

/** The first twelve cards a new player receives: unique, with a fixed mix of rarities. */
export const STARTER_MIX = { eternal: 2, bargain: 2, common: 8 } as const;
export const STARTER_SIZE =
  STARTER_MIX.eternal + STARTER_MIX.bargain + STARTER_MIX.common;

/** Draws a starter pack, avoiding exactly `exclude` when possible (used when the player asks for another twelve). */
export function drawStarterPack(
  cards: readonly CardDef[],
  rng: Rng,
): CardDef[] {
  const pick = (rarity: "eternal" | "bargain" | "common", count: number) => {
    const pool = cards.filter((c) => c.rarity === rarity);
    if (pool.length < count)
      throw new Error(
        `Not enough ${rarity} cards for a starter pack: need ${count}, have ${pool.length}`,
      );
    return shuffle(pool, rng).slice(0, count);
  };
  return [
    ...pick("eternal", STARTER_MIX.eternal),
    ...pick("bargain", STARTER_MIX.bargain),
    ...pick("common", STARTER_MIX.common),
  ];
}

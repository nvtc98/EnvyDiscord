import { describe, expect, it } from "vitest";
import { COLLECTIBLE_CARDS } from "../src/data/cards";
import {
  STARTER_COST_WINDOW,
  STARTER_MIX,
  STARTER_SIZE,
  drawStarterPackBalanced,
} from "../src/game/starter";
import { mulberry32 } from "../src/util/rng";

describe("drawStarterPackBalanced", () => {
  it("always returns twelve unique cards whose mean cost is in the window, keeping the rarity mix", () => {
    for (let seed = 0; seed <= 200; seed++) {
      const pack = drawStarterPackBalanced(COLLECTIBLE_CARDS, mulberry32(seed));
      // size + uniqueness
      expect(pack, `seed ${seed}`).toHaveLength(STARTER_SIZE);
      expect(new Set(pack.map((c) => c.id)).size, `seed ${seed}`).toBe(
        STARTER_SIZE,
      );
      // mean cost inside [2.75, 4.25]
      const mean = pack.reduce((sum, c) => sum + c.cost, 0) / pack.length;
      expect(mean, `seed ${seed} mean`).toBeGreaterThanOrEqual(
        STARTER_COST_WINDOW.min,
      );
      expect(mean, `seed ${seed} mean`).toBeLessThanOrEqual(
        STARTER_COST_WINDOW.max,
      );
      // rarity composition intact (2 eternal + 2 bargain + 8 common)
      const counts = {
        eternal: pack.filter((c) => c.rarity === "eternal").length,
        bargain: pack.filter((c) => c.rarity === "bargain").length,
        common: pack.filter((c) => c.rarity === "common").length,
      };
      expect(counts, `seed ${seed} rarities`).toEqual({
        eternal: STARTER_MIX.eternal,
        bargain: STARTER_MIX.bargain,
        common: STARTER_MIX.common,
      });
    }
  });

  it("still differs between consecutive draws on the same rng", () => {
    const rng = mulberry32(7);
    const a = drawStarterPackBalanced(COLLECTIBLE_CARDS, rng)
      .map((c) => c.id)
      .sort()
      .join();
    const b = drawStarterPackBalanced(COLLECTIBLE_CARDS, rng)
      .map((c) => c.id)
      .sort()
      .join();
    expect(a).not.toBe(b);
  });
});

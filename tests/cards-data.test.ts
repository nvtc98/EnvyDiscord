import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseAbility } from "../src/data/ability-parse";
import { CARDS, CARD_INDEX } from "../src/data/cards";
import type { CardDef } from "../src/engine/types";

// Pre-refactor CardDef values for the seven designed cards (from the plan). These are the
// bytes the old placeholder+OVERRIDES loader produced; the refactor must reproduce them exactly.
const DESIGNED: CardDef[] = [
  {
    id: "stella-eyes",
    name: "Stella Eyes",
    rarity: "eternal",
    cost: 5,
    power: 0,
    ability: { timing: "active", effect: { kind: "destroyedPower" } },
  },
  {
    id: "bedrock-eyes",
    name: "Bedrock Eyes",
    rarity: "common",
    cost: 3,
    power: 5,
    ability: { timing: "active", effect: { kind: "shield" } },
  },
  {
    id: "phoenix-eyes",
    name: "Phoenix Eyes",
    rarity: "common",
    cost: 4,
    power: 4,
    ability: { timing: "onDestroy", effect: { kind: "rebirth", amount: 4 } },
  },
  {
    id: "venom-eyes",
    name: "Venom Eyes",
    rarity: "bargain",
    cost: 5,
    power: 8,
    ability: {
      timing: "continuous",
      effect: { kind: "drainStartOfTurn", amount: 1 },
    },
  },
  {
    id: "ocean-eyes",
    name: "Ocean Eyes",
    rarity: "eternal",
    cost: 1,
    power: 2,
    ability: {
      timing: "endOfRound",
      effect: { kind: "oceanReturn", amount: 1 },
    },
  },
  {
    id: "siren-eyes",
    name: "Siren Eyes",
    rarity: "common",
    cost: 4,
    power: 2,
    ability: { timing: "active", effect: { kind: "pushLane" } },
  },
  {
    id: "laser-eyes",
    name: "Laser Eyes",
    rarity: "common",
    cost: 4,
    power: 4,
    ability: { timing: "active", effect: { kind: "destroyLane" } },
  },
];

const rawCards = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../src/data/cards.json", import.meta.url)),
    "utf8",
  ),
) as Array<{ cost: number; power: number }>;

describe("cards.json data refactor", () => {
  it("the seven designed cards load byte-for-byte unchanged", () => {
    for (const expected of DESIGNED) {
      expect(CARD_INDEX.get(expected.id)).toEqual(expected);
    }
  });

  it("cards.json has 229 entries, all with integer cost/power", () => {
    expect(rawCards).toHaveLength(229);
    for (const c of rawCards) {
      expect(Number.isInteger(c.cost)).toBe(true);
      expect(Number.isInteger(c.power)).toBe(true);
    }
  });

  it("CARDS has 229 unique ids", () => {
    expect(CARDS).toHaveLength(229);
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(229);
  });
});

describe("parseAbility validation", () => {
  it("throws on an unknown token", () => {
    expect(() => parseAbility("nonsense", "Test Eyes")).toThrow(
      /unknown ability token/,
    );
  });

  it("throws when a required amount is missing", () => {
    expect(() => parseAbility("rebirth", "Phoenix Eyes")).toThrow(
      /requires exactly one integer amount/,
    );
  });

  it("throws when an amount is given to a none-token", () => {
    expect(() => parseAbility("shield 2", "Bedrock Eyes")).toThrow(
      /takes no amount/,
    );
  });

  it.each(["heal 1", "damage 1", "healRound 1"])(
    "throws on the removed token %s",
    (shorthand) => {
      expect(() => parseAbility(shorthand, "Test Eyes")).toThrow(
        /unknown ability token/,
      );
    },
  );

  it("no card string in cards.json uses a removed ability token", () => {
    const withAbility = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../src/data/cards.json", import.meta.url)),
        "utf8",
      ),
    ) as Array<{ ability?: string }>;
    for (const c of withAbility) {
      if (!c.ability) continue;
      expect(c.ability).not.toMatch(/^(heal|damage|healRound)\b/);
    }
  });
});

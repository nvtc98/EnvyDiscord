import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseAbility } from "../src/data/ability-parse";
import {
  CARDS,
  CARD_INDEX,
  COLLECTIBLE_CARDS,
  COLLECTIBLE_CARD_INDEX,
} from "../src/data/cards";
import { cardFaction } from "../src/engine/abilities";
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
    faction: "the-eyes",
    ability: { timing: "active", effect: { kind: "destroyedPower" } },
  },
  {
    id: "bedrock-eyes",
    name: "Bedrock Eyes",
    rarity: "common",
    cost: 3,
    power: 5,
    faction: "the-eyes",
    ability: { timing: "active", effect: { kind: "shield" } },
  },
  {
    id: "phoenix-eyes",
    name: "Phoenix Eyes",
    rarity: "common",
    cost: 4,
    power: 4,
    faction: "the-eyes",
    ability: { timing: "onDestroy", effect: { kind: "rebirth", amount: 4 } },
  },
  {
    id: "venom-eyes",
    name: "Venom Eyes",
    rarity: "bargain",
    cost: 5,
    power: 8,
    faction: "the-eyes",
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
    faction: "the-eyes",
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
    faction: "the-eyes",
    ability: { timing: "active", effect: { kind: "pushLane" } },
  },
  {
    id: "laser-eyes",
    name: "Laser Eyes",
    rarity: "common",
    cost: 4,
    power: 4,
    faction: "the-eyes",
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

  it("cards.json has 233 entries, all with integer cost/power", () => {
    expect(rawCards).toHaveLength(233);
    for (const c of rawCards) {
      expect(Number.isInteger(c.cost)).toBe(true);
      expect(Number.isInteger(c.power)).toBe(true);
    }
  });

  it("CARDS has 233 unique ids", () => {
    expect(CARDS).toHaveLength(233);
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(233);
  });

  it("the existing Eyes cards default to the-eyes faction", () => {
    expect(CARD_INDEX.get("stella-eyes")?.faction).toBe("the-eyes");
    expect(CARD_INDEX.get("zenith-eyes")?.faction).toBe("the-eyes");
  });
});

describe("the player-collectible pool is The Eyes only", () => {
  const BOTUOI_IDS = [
    "bo-tuoi",
    "bo-sieu-phan-ong-cap-1",
    "bo-sieu-phan-ong-cap-2",
    "bo-sieu-phan-ong-cap-3",
  ];

  it("COLLECTIBLE_CARDS has 229 cards, none of them botuoi", () => {
    expect(COLLECTIBLE_CARDS).toHaveLength(229);
    expect(COLLECTIBLE_CARDS.every((c) => cardFaction(c) === "the-eyes")).toBe(
      true,
    );
    for (const id of BOTUOI_IDS)
      expect(COLLECTIBLE_CARDS.some((c) => c.id === id)).toBe(false);
  });

  it("COLLECTIBLE_CARD_INDEX mirrors the collectible pool and omits the botuoi ids", () => {
    expect(COLLECTIBLE_CARD_INDEX.size).toBe(229);
    for (const id of BOTUOI_IDS)
      expect(COLLECTIBLE_CARD_INDEX.has(id)).toBe(false);
  });

  it("CARD_INDEX still resolves the botuoi cards for the engine/opponents", () => {
    expect(CARD_INDEX.size).toBe(233);
    for (const id of BOTUOI_IDS) expect(CARD_INDEX.has(id)).toBe(true);
    expect(CARD_INDEX.get("bo-sieu-phan-ong-cap-1")?.faction).toBe("botuoi");
  });
});

describe("the four Bò Tuôi cards", () => {
  it("load with the botuoi faction, the expected cost/power, and the locked display text", () => {
    const tuoi = CARD_INDEX.get("bo-tuoi");
    expect(tuoi).toMatchObject({
      faction: "botuoi",
      cost: 2,
      power: 4,
      text: "Passive: We are Bò Tuôi",
    });
    expect(tuoi?.ability).toBeUndefined();

    const c1 = CARD_INDEX.get("bo-sieu-phan-ong-cap-1");
    expect(c1).toMatchObject({
      faction: "botuoi",
      cost: 1,
      power: 2,
      coefficient: 1,
      text: "Passive: Swings The Tide normally. When 1 card has been destroyed, transform into Bò Siêu Phản Động Cấp 2.",
    });
    expect(c1?.ability).toEqual({
      timing: "continuous",
      effect: {
        kind: "transformAt",
        count: 1,
        into: "bo-sieu-phan-ong-cap-2",
      },
    });

    const c2 = CARD_INDEX.get("bo-sieu-phan-ong-cap-2");
    expect(c2).toMatchObject({
      faction: "botuoi",
      cost: 1,
      power: 4,
      coefficient: 2,
      text: "Passive: Swings The Tide 2 times harder. When 2 cards have been destroyed, transform into Bò Siêu Phản Động Cấp 3.",
    });
    expect(c2?.ability).toEqual({
      timing: "continuous",
      effect: {
        kind: "transformAt",
        count: 2,
        into: "bo-sieu-phan-ong-cap-3",
      },
    });

    const c3 = CARD_INDEX.get("bo-sieu-phan-ong-cap-3");
    expect(c3).toMatchObject({
      faction: "botuoi",
      cost: 1,
      power: 6,
      text: "Passive: Swings The Tide 3 times harder.",
    });
    expect(c3?.ability).toEqual({
      timing: "continuous",
      effect: { kind: "balanceCoefficient", k: 3 },
    });
    expect(c3?.coefficient).toBeUndefined();
  });

  it("every transformAt target resolves in CARD_INDEX", () => {
    for (const card of CARDS) {
      const ab = card.ability;
      if (ab?.timing === "continuous" && ab.effect.kind === "transformAt")
        expect(
          CARD_INDEX.has(ab.effect.into),
          `${card.id} -> ${ab.effect.into}`,
        ).toBe(true);
    }
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

  it("parses transformAt into a continuous effect with count and into", () => {
    expect(parseAbility("transformAt 2 bo-sieu-phan-ong-cap-3", "Bò")).toEqual({
      timing: "continuous",
      effect: {
        kind: "transformAt",
        count: 2,
        into: "bo-sieu-phan-ong-cap-3",
      },
    });
  });

  it("parses balanceCoefficient into a continuous effect with k", () => {
    expect(parseAbility("balanceCoefficient 3", "Bò")).toEqual({
      timing: "continuous",
      effect: { kind: "balanceCoefficient", k: 3 },
    });
  });

  it("throws when transformAt is missing an argument", () => {
    expect(() => parseAbility("transformAt 1", "Bò")).toThrow(
      /requires 2 arguments/,
    );
  });

  it("throws when transformAt count is not a positive integer", () => {
    expect(() => parseAbility("transformAt 0 target", "Bò")).toThrow(
      /positive integer count/,
    );
    expect(() => parseAbility("transformAt x target", "Bò")).toThrow(
      /positive integer count/,
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

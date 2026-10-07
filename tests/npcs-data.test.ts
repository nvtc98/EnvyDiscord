import { describe, expect, it } from "vitest";
import { CARD_INDEX } from "../src/data/cards";
import {
  NPCS,
  NPC_INDEX,
  npcDeck,
  validateNpc,
  validateNpcs,
  type NPCDef,
} from "../src/data/npcs";

/** A valid Bò-SPD-shaped entry, cloned so tests can mutate a single field to craft a bad entry. */
const goodEntry = (): NPCDef => ({
  id: "bo-spd",
  name: "Bò SPD",
  deck: [
    "bo-tuoi",
    "bo-tuoi",
    "bo-tuoi",
    "bo-tuoi",
    "bo-tuoi",
    "bo-tuoi",
    "bo-tuoi",
    "bo-tuoi",
    "bo-tuoi",
    "bo-tuoi",
    "bo-tuoi",
    "bo-sieu-phan-ong-cap-1",
  ],
  portrait: "boss-spd-battle",
  guaranteedOpening: ["bo-sieu-phan-ong-cap-1"],
  goesFirst: true,
});

describe("npcs.json loads and validates", () => {
  it("NPCS loads with the Bò SPD definition", () => {
    expect(NPCS.length).toBeGreaterThanOrEqual(1);
    const boSpd = NPC_INDEX.get("bo-spd");
    expect(boSpd).toBeDefined();
    expect(boSpd!.name).toBe("Bò SPD");
    expect(boSpd!.deck).toHaveLength(12);
    expect(boSpd!.deck.filter((id) => id === "bo-tuoi")).toHaveLength(11);
    expect(
      boSpd!.deck.filter((id) => id === "bo-sieu-phan-ong-cap-1"),
    ).toHaveLength(1);
    expect(boSpd!.portrait).toBe("boss-spd-battle");
    expect(boSpd!.guaranteedOpening).toEqual(["bo-sieu-phan-ong-cap-1"]);
    expect(boSpd!.goesFirst).toBe(true);
  });
});

describe("validateNpc throws loudly on bad data", () => {
  it("accepts a good entry", () => {
    expect(() => validateNpc(goodEntry())).not.toThrow();
  });

  it("throws on the wrong deck length", () => {
    const bad = goodEntry();
    bad.deck = bad.deck.slice(0, 11);
    expect(() => validateNpc(bad)).toThrow(
      /deck has 11 cards, expected 12/,
    );
  });

  it("throws on an unknown card id in the deck", () => {
    const bad = goodEntry();
    bad.deck[0] = "not-a-real-card";
    expect(() => validateNpc(bad)).toThrow(
      /deck has unknown card id "not-a-real-card"/,
    );
  });

  it("throws when a guaranteedOpening id is not in the deck", () => {
    const bad = goodEntry();
    bad.guaranteedOpening = ["venom-eyes"];
    expect(() => validateNpc(bad)).toThrow(
      /guaranteedOpening card "venom-eyes" is not in its deck/,
    );
  });

  it("throws on a missing name", () => {
    const bad = goodEntry();
    bad.name = "";
    expect(() => validateNpc(bad)).toThrow(/missing a non-empty name/);
  });

  it("throws on an empty portrait", () => {
    const bad = goodEntry();
    bad.portrait = "";
    expect(() => validateNpc(bad)).toThrow(/missing a non-empty portrait/);
  });
});

describe("validateNpcs throws on duplicate ids", () => {
  it("throws when two entries share an id", () => {
    expect(() => validateNpcs([goodEntry(), goodEntry()])).toThrow(
      /duplicate NPC id "bo-spd"/,
    );
  });
});

describe("npcDeck resolves ids to CardDefs with duplicates preserved", () => {
  it("returns 12 defs: 11 identical bo-tuoi refs + 1 cap-1", () => {
    const boSpd = NPC_INDEX.get("bo-spd")!;
    const defs = npcDeck(boSpd);
    expect(defs).toHaveLength(12);
    expect(defs.filter((d) => d.id === "bo-tuoi")).toHaveLength(11);
    expect(defs.filter((d) => d.id === "bo-sieu-phan-ong-cap-1")).toHaveLength(
      1,
    );
    // The eleven bo-tuoi elements are the SAME CardDef object reference (duplicate support).
    const tuoiRef = CARD_INDEX.get("bo-tuoi");
    for (const d of defs.filter((d) => d.id === "bo-tuoi"))
      expect(d).toBe(tuoiRef);
  });

  it("throws on an unknown id against a custom (empty) index", () => {
    const boSpd = NPC_INDEX.get("bo-spd")!;
    expect(() => npcDeck(boSpd, new Map())).toThrow(
      /references unknown card id "bo-tuoi"/,
    );
  });
});

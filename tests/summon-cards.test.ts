import { describe, expect, it } from "vitest";

import { endTurn } from "../src/engine/rules";
import type {
  Ability,
  CardDef,
  CardInstance,
  GameEvent,
  GameState,
  LaneIndex,
  Seat,
} from "../src/engine/types";
import { mulberry32 } from "../src/util/rng";
import { def, emptyGame, instance, setLane } from "./engine-helpers";

// --- Ability constructors (mirror the shorthand tokens in cards.json) --------
const summonHand = (): Ability => ({
  timing: "active",
  effect: { kind: "summonHand" },
});
const summonDeck = (): Ability => ({
  timing: "active",
  effect: { kind: "summonDeck" },
});
const vaporSummon = (): Ability => ({
  timing: "active",
  effect: { kind: "vaporSummon" },
});
const chronosSummon = (): Ability => ({
  timing: "active",
  effect: { kind: "chronosSummon" },
});
const evilHighest = (): Ability => ({
  timing: "active",
  effect: { kind: "evilHighest" },
});
// A simple active that gains +100 power on play, used to prove a summoned card fires its ability.
const selfBuff = (): Ability => ({
  timing: "active",
  effect: { kind: "destroyedPower" },
});

// --- Helpers -----------------------------------------------------------------
const onBoard = (state: GameState): CardInstance[] =>
  state.lanes.flat().filter((c): c is CardInstance => c !== null);
const find = (state: GameState, id: string) =>
  onBoard(state).find((c) => c.def.id === id);
const abilityTexts = (events: readonly GameEvent[]) =>
  events
    .filter((e): e is Extract<GameEvent, { type: "ability" }> => e.type === "ability")
    .map((e) => e.text);
const setDeck = (
  state: GameState,
  seat: Seat,
  entries: { def: CardDef; bonus: number }[],
) => {
  state.players[seat].deck = entries;
};

// =============================================================================
// Mortal Eyes (summonHand)
// =============================================================================
describe("Mortal Eyes / summonHand", () => {
  it("summons a random hand card into the empty front cell", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const mortal = instance(def("MORTAL", 3, 3, summonHand()), "bottom");
    setLane(state, 0, [null, null, mortal]); // bottom edge; front cell is 1
    state.players.bottom.hand = [instance(def("ALLY", 1, 2), "bottom")];
    const { state: after, events } = endTurn(state, mulberry32(1));
    // ALLY left the hand and now sits in the front cell (cell 1) of lane 0.
    expect(after.players.bottom.hand.length).toBe(0);
    expect(after.lanes[0][1]?.def.id).toBe("ALLY");
    expect(abilityTexts(events)).toContain("summoned ALLY");
  });

  it("does nothing when the front cell is occupied", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const mortal = instance(def("MORTAL", 3, 3, summonHand()), "bottom");
    const blocker = instance(def("BLOCK", 1, 1), "bottom");
    setLane(state, 0, [null, blocker, mortal]); // front cell (1) is occupied
    state.players.bottom.hand = [instance(def("ALLY", 1, 2), "bottom")];
    const { state: after, events } = endTurn(state, mulberry32(1));
    expect(after.players.bottom.hand.length).toBe(1); // ALLY stays in hand
    expect(find(after, "ALLY")).toBeUndefined();
    expect(abilityTexts(events)).not.toContain("summoned ALLY");
  });

  it("does nothing when at the enemy edge (no cell in front)", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    // bottom's enemy edge is cell 0; frontCell(bottom, 0) = -1 → out of range.
    const mortal = instance(def("MORTAL", 3, 3, summonHand()), "bottom");
    setLane(state, 0, [mortal, null, null]);
    state.players.bottom.hand = [instance(def("ALLY", 1, 2), "bottom")];
    const { state: after } = endTurn(state, mulberry32(1));
    expect(after.players.bottom.hand.length).toBe(1);
  });

  it("does nothing with an empty hand", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const mortal = instance(def("MORTAL", 3, 3, summonHand()), "bottom");
    setLane(state, 0, [null, null, mortal]);
    state.players.bottom.hand = [];
    const { state: after, events } = endTurn(state, mulberry32(1));
    expect(after.lanes[0][1]).toBeNull();
    expect(abilityTexts(events).some((t) => t.startsWith("summoned"))).toBe(
      false,
    );
  });

  it("the summoned card fires its own active ability", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    state.destroyedPower = 42; // a destroyedPower active sets bonus to this tally on play
    const mortal = instance(def("MORTAL", 3, 3, summonHand()), "bottom");
    setLane(state, 0, [null, null, mortal]);
    state.players.bottom.hand = [
      instance(def("SELF", 1, 0, selfBuff()), "bottom"),
    ];
    const { state: after } = endTurn(state, mulberry32(1));
    // SELF's destroyedPower active ran, so its bonus is the tally (42).
    expect(after.lanes[0][1]?.def.id).toBe("SELF");
    expect(after.lanes[0][1]?.bonus).toBe(42);
  });
});

// =============================================================================
// Omen Eyes (summonDeck)
// =============================================================================
describe("Omen Eyes / summonDeck", () => {
  it("summons a deck card into the front cell, carrying its deck bonus", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const omen = instance(def("OMEN", 2, 0, summonDeck()), "bottom");
    setLane(state, 0, [null, null, omen]);
    setDeck(state, "bottom", [{ def: def("CARD", 1, 2), bonus: 5 }]);
    const { state: after, events } = endTurn(state, mulberry32(1));
    expect(after.players.bottom.deck.length).toBe(0);
    expect(after.lanes[0][1]?.def.id).toBe("CARD");
    expect(after.lanes[0][1]?.bonus).toBe(5); // deck bonus carried over
    expect(abilityTexts(events)).toContain("summoned CARD");
  });

  it("does nothing with an empty deck", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const omen = instance(def("OMEN", 2, 0, summonDeck()), "bottom");
    setLane(state, 0, [null, null, omen]);
    setDeck(state, "bottom", []);
    const { state: after } = endTurn(state, mulberry32(1));
    expect(after.lanes[0][1]).toBeNull();
  });
});

// =============================================================================
// Vapor Eyes (vaporSummon)
// =============================================================================
describe("Vapor Eyes / vaporSummon", () => {
  it("vanishes and summons a strictly-higher-cost deck card into the vacated cell", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const vapor = instance(def("VAPOR", 4, 0, vaporSummon()), "bottom");
    setLane(state, 0, [null, null, vapor]); // cell 2
    setDeck(state, "bottom", [{ def: def("BIG", 7, 9), bonus: 0 }]);
    const { state: after, events } = endTurn(state, mulberry32(1));
    // Vapor gone; BIG now sits in Vapor's old cell (2).
    expect(find(after, "VAPOR")).toBeUndefined();
    expect(after.lanes[0][2]?.def.id).toBe("BIG");
    expect(after.players.bottom.deck.length).toBe(0);
    expect(abilityTexts(events)).toContain("summoned BIG");
  });

  it("only considers deck cards with base cost strictly greater than Vapor's cost (4)", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const vapor = instance(def("VAPOR", 4, 0, vaporSummon()), "bottom");
    setLane(state, 0, [null, null, vapor]);
    // Equal cost (4) and lower cost (3) are NOT candidates; only cost 5 qualifies.
    setDeck(state, "bottom", [
      { def: def("EQ", 4, 1), bonus: 0 },
      { def: def("LO", 3, 1), bonus: 0 },
      { def: def("HI", 5, 1), bonus: 0 },
    ]);
    const { state: after } = endTurn(state, mulberry32(1));
    expect(after.lanes[0][2]?.def.id).toBe("HI");
    // EQ and LO remain in the deck.
    expect(after.players.bottom.deck.map((e) => e.def.id).sort()).toEqual([
      "EQ",
      "LO",
    ]);
  });

  it("just vanishes (no summon) when no higher-cost deck card exists", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const vapor = instance(def("VAPOR", 4, 0, vaporSummon()), "bottom");
    setLane(state, 0, [null, null, vapor]);
    setDeck(state, "bottom", [{ def: def("SAME", 4, 9), bonus: 0 }]);
    const { state: after, events } = endTurn(state, mulberry32(1));
    expect(find(after, "VAPOR")).toBeUndefined();
    expect(after.lanes[0][2]).toBeNull();
    expect(after.players.bottom.deck.length).toBe(1); // SAME untouched
    expect(abilityTexts(events)).toContain("vanished");
  });

  it("vanishing does not touch destroyedPower or destroyedCount", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const vapor = instance(def("VAPOR", 4, 7, vaporSummon()), "bottom");
    setLane(state, 0, [null, null, vapor]);
    setDeck(state, "bottom", []);
    const before = {
      power: state.destroyedPower,
      count: state.destroyedCount,
    };
    const { state: after } = endTurn(state, mulberry32(1));
    expect(after.destroyedPower).toBe(before.power);
    expect(after.destroyedCount).toBe(before.count);
  });
});

// =============================================================================
// Chronos Eyes (chronosSummon)
// =============================================================================
describe("Chronos Eyes / chronosSummon", () => {
  // Drive bottom through two of its own end-of-turns, with top's turn in between.
  const runTwoTurns = (
    build: (s: GameState) => CardInstance,
    seed = 1,
    killChronosBetween = false,
  ) => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const chronos = build(state);

    // Turn A: bottom ends its turn — Chronos destroys the highest-cost hand card.
    const a = endTurn(state, mulberry32(seed));
    // Top's turn (no abilities).
    const b = endTurn(a.state, mulberry32(seed));
    if (killChronosBetween) {
      // Remove Chronos from the board before bottom's turn B resolves.
      const found = onBoard(b.state).find((c) => c.def.id === "CHRONOS");
      if (found) {
        for (let l = 0; l < 3; l++)
          for (let i = 0; i < 3; i++)
            if (b.state.lanes[l][i]?.uid === found.uid)
              b.state.lanes[l][i] = null;
      }
    }
    // Turn B: bottom ends its turn again — Chronos summons the pending card if alive.
    const c = endTurn(b.state, mulberry32(seed));
    return { a, b, c };
  };

  it("turn A destroys the highest-cost hand card without a destroy tally", () => {
    const build = (s: GameState) => {
      const chronos = instance(def("CHRONOS", 4, 8, chronosSummon()), "bottom");
      setLane(s, 0, [null, null, chronos]);
      s.players.bottom.hand = [
        instance(def("CHEAP", 2, 1), "bottom"),
        instance(def("PRICEY", 7, 1), "bottom"),
      ];
      return chronos;
    };
    const { a } = runTwoTurns(build);
    // The 7-cost card was removed from hand; the 2-cost stays.
    expect(a.state.players.bottom.hand.map((c) => c.def.id)).toEqual(["CHEAP"]);
    // Pure hand discard: no destroy tally.
    expect(a.state.destroyedPower).toBe(0);
    expect(a.state.destroyedCount).toBe(0);
    expect(abilityTexts(a.events)).toContain("destroyed PRICEY from its hand");
  });

  it("turn B summons the destroyed card in front of a living Chronos", () => {
    const build = (s: GameState) => {
      const chronos = instance(def("CHRONOS", 4, 8, chronosSummon()), "bottom");
      setLane(s, 0, [null, null, chronos]);
      s.players.bottom.hand = [instance(def("PRICEY", 7, 1), "bottom")];
      return chronos;
    };
    const { c } = runTwoTurns(build);
    // PRICEY summoned into Chronos's front cell (lane 0, cell 1).
    expect(c.state.lanes[0][1]?.def.id).toBe("PRICEY");
    expect(abilityTexts(c.events)).toContain("summoned PRICEY");
  });

  it("summons nothing if Chronos is destroyed before turn B", () => {
    const build = (s: GameState) => {
      const chronos = instance(def("CHRONOS", 4, 8, chronosSummon()), "bottom");
      setLane(s, 0, [null, null, chronos]);
      s.players.bottom.hand = [instance(def("PRICEY", 7, 1), "bottom")];
      return chronos;
    };
    const { c } = runTwoTurns(build, 1, true);
    expect(find(c.state, "PRICEY")).toBeUndefined();
    expect(find(c.state, "CHRONOS")).toBeUndefined();
  });
});

// =============================================================================
// Evil Eyes (evilHighest)
// =============================================================================
describe("Evil Eyes / evilHighest", () => {
  it("gives only the highest-cost owner cards +power equal to their cost", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const evil = instance(def("EVIL", 4, 6, evilHighest()), "bottom");
    const bigA = instance(def("BIGA", 8, 1), "bottom");
    const bigB = instance(def("BIGB", 8, 1), "bottom");
    const mid = instance(def("MID", 7, 1), "bottom");
    setLane(state, 0, [bigA, null, evil]);
    setLane(state, 1, [bigB, null, mid]);
    const { state: after, events } = endTurn(state, mulberry32(1));
    // Highest cost is 8; both 8-cost cards gain +8, the 7-cost does not.
    expect(find(after, "BIGA")?.bonus).toBe(8);
    expect(find(after, "BIGB")?.bonus).toBe(8);
    expect(find(after, "MID")?.bonus).toBe(0);
    expect(find(after, "EVIL")?.bonus).toBe(0); // cost 4, not the max
    expect(abilityTexts(events)).toContain(
      "gave +8 power to 2 highest-cost cards",
    );
  });

  it("counts Evil itself when it is the highest-cost card", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const evil = instance(def("EVIL", 4, 6, evilHighest()), "bottom");
    const low = instance(def("LOW", 1, 1), "bottom");
    setLane(state, 0, [low, null, evil]);
    const { state: after } = endTurn(state, mulberry32(1));
    // Evil (cost 4) is the highest, so it gains +4; the 1-cost ally gains nothing.
    expect(find(after, "EVIL")?.bonus).toBe(4);
    expect(find(after, "LOW")?.bonus).toBe(0);
  });

  it("ignores enemy cards when finding the highest cost", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const evil = instance(def("EVIL", 4, 6, evilHighest()), "bottom");
    const enemyBig = instance(def("ENEMY", 9, 1), "top");
    setLane(state, 0, [enemyBig, null, evil]);
    const { state: after } = endTurn(state, mulberry32(1));
    // The enemy's 9-cost card is ignored; Evil (cost 4) is the owner's highest.
    expect(find(after, "EVIL")?.bonus).toBe(4);
    expect(find(after, "ENEMY")?.bonus).toBe(0);
  });
});

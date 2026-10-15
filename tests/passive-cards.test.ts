import { describe, expect, it } from "vitest";

import {
  canPlay,
  endTurn,
  instanceCost,
  legalPlays,
  playCard,
} from "../src/engine/rules";
import type {
  Ability,
  CardDef,
  CardInstance,
  GameState,
  LaneIndex,
  Seat,
} from "../src/engine/types";
import { mulberry32 } from "../src/util/rng";
import { def, emptyGame, give, instance, setLane } from "./engine-helpers";

// --- Ability constructors (mirror the shorthand tokens in cards.json) --------
const ancientDiscount = (): Ability => ({
  timing: "continuous",
  effect: { kind: "ancientDiscount" },
});
const vaingloryGate = (): Ability => ({
  timing: "continuous",
  effect: { kind: "vaingloryGate" },
});
const guardianLane = (): Ability => ({
  timing: "continuous",
  effect: { kind: "guardianLane" },
});
const laser = (): Ability => ({
  timing: "active",
  effect: { kind: "destroyLane" },
});
const berserkKill = (): Ability => ({
  timing: "active",
  effect: { kind: "berserkKill" },
});
const siren = (): Ability => ({
  timing: "active",
  effect: { kind: "pushLane" },
});

// --- Helpers -----------------------------------------------------------------
const onBoard = (state: GameState): CardInstance[] =>
  state.lanes.flat().filter((c): c is CardInstance => c !== null);
const find = (state: GameState, id: string) =>
  onBoard(state).find((c) => c.def.id === id);

/** Plays a card from `seat`'s hand into `lane`, paying its cost. */
function play(
  state: GameState,
  seat: Seat,
  card: CardDef,
  lane: LaneIndex,
): GameState {
  const c = give(state, seat, card);
  state.players[seat].energy = Math.max(state.players[seat].energy, card.cost);
  return playCard(state, c.uid, lane).state;
}

// =============================================================================
// Ancient Eyes (ancientDiscount)
// =============================================================================
describe("Ancient Eyes / ancientDiscount", () => {
  it("drops the in-hand cost by 1 at each of the owner's end-of-turns", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const ancient = instance(def("ANCIENT", 8, 18, ancientDiscount()), "bottom");
    state.players.bottom.hand = [ancient];
    // Base cost 8, no discount yet.
    expect(instanceCost(state, "bottom", ancient)).toBe(8);

    // Bottom's end-of-turn ticks the discount once.
    const a = endTurn(state, mulberry32(1));
    const liveA = a.state.players.bottom.hand.find((c) => c.uid === ancient.uid)!;
    expect(liveA.costReduction).toBe(1);
    expect(instanceCost(a.state, "bottom", liveA)).toBe(7);

    // Top's turn does NOT tick bottom's Ancient.
    const b = endTurn(a.state, mulberry32(1));
    const liveB = b.state.players.bottom.hand.find((c) => c.uid === ancient.uid)!;
    expect(liveB.costReduction).toBe(1);

    // Bottom's next end-of-turn ticks it again (now 2 → cost 6).
    const c = endTurn(b.state, mulberry32(1));
    const liveC = c.state.players.bottom.hand.find((c) => c.uid === ancient.uid)!;
    expect(liveC.costReduction).toBe(2);
    expect(instanceCost(c.state, "bottom", liveC)).toBe(6);
  });

  it("floors the live cost at 0 (never negative)", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    // A cheap Ancient-like card discounted past 0.
    const ancient = instance(def("ANCIENT", 1, 1, ancientDiscount()), "bottom");
    ancient.costReduction = 5;
    state.players.bottom.hand = [ancient];
    expect(instanceCost(state, "bottom", ancient)).toBe(0);
  });

  it("the discount gates canPlay — a card too dear becomes affordable", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const ancient = instance(def("ANCIENT", 3, 5, ancientDiscount()), "bottom");
    state.players.bottom.hand = [ancient];
    state.players.bottom.energy = 2; // 2 < base cost 3 → not playable
    expect(canPlay(state, ancient.uid, 0).ok).toBe(false);
    // Accrue 1 discount; now cost 2 ≤ energy 2 → playable.
    ancient.costReduction = 1;
    expect(canPlay(state, ancient.uid, 0).ok).toBe(true);
  });
});

// =============================================================================
// Vainglory Eyes (vaingloryGate)
// =============================================================================
describe("Vainglory Eyes / vaingloryGate", () => {
  // emptyGame starts with 50/50 HP (total 100, balance = bottom's HP = 50).
  const setBottomHP = (state: GameState, hp: number) => {
    state.balance = hp; // bottom's HP; top's HP = total - balance
  };

  it("is unplayable when the owner's HP is not below the enemy's", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const vain = give(state, "bottom", def("VAIN", 2, 6, vaingloryGate()));
    state.players.bottom.energy = 5;
    // Even HP (50/50): owner HP is NOT below enemy HP → blocked.
    setBottomHP(state, 50);
    expect(canPlay(state, vain.uid, 0)).toEqual({ ok: false, reason: "blocked" });
    // Owner ahead (bottom HP 70 > top 30): still blocked.
    setBottomHP(state, 70);
    expect(canPlay(state, vain.uid, 0)).toEqual({ ok: false, reason: "blocked" });
  });

  it("is playable only while The Eyes Privilege favors the enemy (owner HP < enemy HP)", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const vain = give(state, "bottom", def("VAIN", 2, 6, vaingloryGate()));
    state.players.bottom.energy = 5;
    setBottomHP(state, 30); // bottom 30 < top 70 → playable
    expect(canPlay(state, vain.uid, 0).ok).toBe(true);
  });

  it("is hidden from legalPlays when gated", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const vain = give(state, "bottom", def("VAIN", 2, 6, vaingloryGate()));
    state.players.bottom.energy = 5;
    setBottomHP(state, 50); // not favored → gated
    expect(legalPlays(state).some((p) => p.uid === vain.uid)).toBe(false);
    setBottomHP(state, 30); // favored → appears
    expect(legalPlays(state).some((p) => p.uid === vain.uid)).toBe(true);
  });

  it("the gate reads from the top seat's perspective too", () => {
    const state = emptyGame("top");
    state.active = "top";
    const vain = give(state, "top", def("VAIN", 2, 6, vaingloryGate()));
    state.players.top.energy = 5;
    // top's HP = total - balance. balance 70 → top HP 30 < bottom 70 → playable.
    state.balance = 70;
    expect(canPlay(state, vain.uid, 0).ok).toBe(true);
    // balance 30 → top HP 70 > bottom 30 → blocked.
    state.balance = 30;
    expect(canPlay(state, vain.uid, 0).ok).toBe(false);
  });
});

// =============================================================================
// Guardian Eyes (guardianLane)
// =============================================================================
describe("Guardian Eyes / guardianLane", () => {
  it("a friendly card in Guardian's lane survives a friendly Laser; itself too", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const guardian = instance(def("GUARD", 5, 10, guardianLane()), "bottom");
    const ally = instance(def("ALLY", 1, 3), "bottom");
    // Guardian + ally share lane 0; Laser (bottom) enters at cell 2.
    setLane(state, 0, [guardian, ally, null]);
    const after = play(state, "bottom", def("LASER", 3, 1, laser()), 0);
    // Both the ally and the Guardian survive; nothing tallied.
    expect(find(after, "ALLY")).toBeDefined();
    expect(find(after, "GUARD")).toBeDefined();
    expect(after.destroyedPower).toBe(0);
    expect(after.destroyedCount).toBe(0);
  });

  it("does NOT protect an enemy card sharing Guardian's lane", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const guardian = instance(def("GUARD", 5, 10, guardianLane()), "bottom");
    const foe = instance(def("FOE", 1, 4), "top");
    // Guardian (bottom) and an enemy FOE share lane 0; a bottom Laser enters at cell 2.
    setLane(state, 0, [guardian, foe, null]);
    const after = play(state, "bottom", def("LASER", 3, 1, laser()), 0);
    // The enemy card has no owner-matching Guardian, so Laser destroys it.
    expect(find(after, "FOE")).toBeUndefined();
    expect(find(after, "GUARD")).toBeDefined();
    expect(after.destroyedPower).toBe(4);
  });

  it("protects a friendly victim from Berserk in the same lane", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const guardian = instance(def("GUARD", 5, 10, guardianLane()), "bottom");
    const friend = instance(def("FRN", 1, 3), "bottom");
    const berserk = instance(def("BSK", 4, 4, berserkKill()), "bottom");
    // Berserk at cell 2 fronts cell 1 (friend); Guardian elsewhere in the lane shields it.
    setLane(state, 0, [guardian, friend, berserk]);
    const { state: after } = endTurn(state, mulberry32(1));
    expect(find(after, "FRN")).toBeDefined();
    expect(after.destroyedCount).toBe(0);
  });

  it("walls a friendly card at the far edge against a Siren off-edge push", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    // top's far edge (relative to a bottom Siren) is cell 0. Put a top Guardian + a top ally there,
    // so the ally cannot be shoved off: it is protected and acts as a wall.
    const guardian = instance(def("GUARD", 5, 10, guardianLane()), "top");
    const ally = instance(def("TALLY", 1, 6), "top");
    setLane(state, 0, [ally, guardian, null]); // Siren (bottom) enters at cell 2
    const after = play(state, "bottom", def("SIR", 4, 2, siren()), 0);
    // The protected ally survives at the far edge; nothing falls off, nothing tallied.
    expect(find(after, "TALLY")).toBeDefined();
    expect(after.destroyedPower).toBe(0);
    expect(after.destroyedCount).toBe(0);
  });

  it("does not shield a lane with no Guardian (a plain push still destroys)", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const foeFar = instance(def("FAR", 1, 5), "top");
    const foeMid = instance(def("MID", 1, 1), "top");
    setLane(state, 0, [foeFar, foeMid, null]); // no Guardian anywhere
    const after = play(state, "bottom", def("SIR", 4, 2, siren()), 0);
    // Without a Guardian, the far enemy card is shoved off and tallied as before.
    expect(find(after, "FAR")).toBeUndefined();
    expect(after.destroyedPower).toBe(5);
  });
});

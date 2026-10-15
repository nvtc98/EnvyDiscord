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
const watcherDig = (): Ability => ({
  timing: "active",
  effect: { kind: "watcherDig" },
});
const moonlitSacrifice = (): Ability => ({
  timing: "active",
  effect: { kind: "moonlitSacrifice" },
});
const titanShift = (): Ability => ({
  timing: "active",
  effect: { kind: "titanShift" },
});
const apexSwap = (): Ability => ({
  timing: "active",
  effect: { kind: "apexSwap" },
});
const berserkKill = (): Ability => ({
  timing: "active",
  effect: { kind: "berserkKill" },
});
const wildShift = (): Ability => ({
  timing: "endOfRound",
  effect: { kind: "wildShift" },
});
const phoenix = (amount = 4): Ability => ({
  timing: "onDestroy",
  effect: { kind: "rebirth", amount },
});

// --- Helpers -----------------------------------------------------------------
const onBoard = (state: GameState): CardInstance[] =>
  state.lanes.flat().filter((c): c is CardInstance => c !== null);
const find = (state: GameState, uid: number) =>
  onBoard(state).find((c) => c.uid === uid);
const movedEvents = (events: readonly GameEvent[]) =>
  events.filter(
    (e): e is Extract<GameEvent, { type: "moved" }> => e.type === "moved",
  );
/** Set the ended seat's deck directly (deck entries carry a per-card bonus). */
const setDeck = (
  state: GameState,
  seat: Seat,
  entries: { def: CardDef; bonus: number }[],
) => {
  state.players[seat].deck = entries;
};

// =============================================================================
// Watcher's Eyes (watcherDig)
// =============================================================================
describe("Watcher's Eyes / watcherDig", () => {
  const buildThreeCardDeck = (state: GameState) =>
    setDeck(state, "bottom", [
      { def: def("LOW", 1, 1), bonus: 0 }, // effective 1
      { def: def("MID", 1, 5), bonus: 0 }, // effective 5
      { def: def("HIGH", 1, 9), bonus: 0 }, // effective 9
    ]);

  const run = (lane: LaneIndex) => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    buildThreeCardDeck(state);
    const watcher = instance(def("WAT", 3, 5, watcherDig()), "bottom");
    setLane(state, lane, [null, null, watcher]);
    return endTurn(state, mulberry32(1));
  };

  it("LEFT lane draws the weakest of the top 3", () => {
    const { state } = run(0);
    const hand = state.players.bottom.hand;
    expect(hand.map((c) => c.def.id)).toEqual(["LOW"]);
    // Non-chosen stay on top in original order (no shuffle).
    expect(state.players.bottom.deck.map((e) => e.def.id)).toEqual([
      "MID",
      "HIGH",
    ]);
  });

  it("CENTER lane draws the middle of the top 3", () => {
    const { state } = run(1);
    expect(state.players.bottom.hand.map((c) => c.def.id)).toEqual(["MID"]);
    expect(state.players.bottom.deck.map((e) => e.def.id)).toEqual([
      "LOW",
      "HIGH",
    ]);
  });

  it("RIGHT lane draws the strongest of the top 3", () => {
    const { state } = run(2);
    expect(state.players.bottom.hand.map((c) => c.def.id)).toEqual(["HIGH"]);
    expect(state.players.bottom.deck.map((e) => e.def.id)).toEqual([
      "LOW",
      "MID",
    ]);
  });

  it("effective power counts the deck entry bonus (not just base power)", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    // Base power says A is strongest, but B's bonus makes B effectively strongest.
    setDeck(state, "bottom", [
      { def: def("A", 1, 6), bonus: 0 }, // effective 6
      { def: def("B", 1, 2), bonus: 10 }, // effective 12
      { def: def("C", 1, 4), bonus: 0 }, // effective 4
    ]);
    const watcher = instance(def("WAT", 3, 5, watcherDig()), "bottom");
    setLane(state, 2, [null, null, watcher]); // RIGHT → strongest
    const { state: after } = endTurn(state, mulberry32(1));
    expect(after.players.bottom.hand.map((c) => c.def.id)).toEqual(["B"]);
  });

  it("2-card deck: left=lower, center=lower, right=higher", () => {
    const two = () => [
      { def: def("LO", 1, 2), bonus: 0 },
      { def: def("HI", 1, 8), bonus: 0 },
    ];
    for (const [lane, expected] of [
      [0, "LO"],
      [1, "LO"],
      [2, "HI"],
    ] as const) {
      const state = emptyGame("bottom");
      state.active = "bottom";
      setDeck(state, "bottom", two());
      const watcher = instance(def("WAT", 3, 5, watcherDig()), "bottom");
      setLane(state, lane, [null, null, watcher]);
      const { state: after } = endTurn(state, mulberry32(1));
      expect(after.players.bottom.hand.map((c) => c.def.id)).toEqual([
        expected,
      ]);
    }
  });

  it("1-card deck: draws that one regardless of lane", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    setDeck(state, "bottom", [{ def: def("ONLY", 1, 3), bonus: 0 }]);
    const watcher = instance(def("WAT", 3, 5, watcherDig()), "bottom");
    setLane(state, 1, [null, null, watcher]);
    const { state: after } = endTurn(state, mulberry32(1));
    expect(after.players.bottom.hand.map((c) => c.def.id)).toEqual(["ONLY"]);
    expect(after.players.bottom.deck.length).toBe(0);
  });

  it("draws nothing before end of turn (defers to resolveTurn)", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    buildThreeCardDeck(state);
    const watcher = instance(def("WAT", 3, 5, watcherDig()), "bottom");
    setLane(state, 0, [null, null, watcher]);
    // Pre-endTurn: hand is still empty.
    expect(state.players.bottom.hand.length).toBe(0);
  });

  it("full hand burns the dug card (hand size unchanged, deck shrinks)", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    buildThreeCardDeck(state);
    // Fill the hand to MAX_HAND (6).
    state.players.bottom.hand = Array.from({ length: 6 }, (_, i) =>
      instance(def(`H${i}`, 1, 1), "bottom"),
    );
    const watcher = instance(def("WAT", 3, 5, watcherDig()), "bottom");
    setLane(state, 0, [null, null, watcher]);
    const { state: after, events } = endTurn(state, mulberry32(1));
    expect(after.players.bottom.hand.length).toBe(6); // unchanged
    expect(after.players.bottom.deck.length).toBe(2); // chosen entry removed
    expect(events.some((e) => e.type === "burned")).toBe(true);
  });
});

// =============================================================================
// Moonlit Eyes (moonlitSacrifice)
// =============================================================================
describe("Moonlit Eyes / moonlitSacrifice", () => {
  it("destroys the hand (feeding Stella) and spreads the summed effective power across the board", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const moonlit = instance(def("MOON", 6, 4, moonlitSacrifice()), "bottom");
    const ally = instance(def("ALLY", 1, 1), "bottom");
    setLane(state, 0, [null, null, moonlit]);
    setLane(state, 1, [null, null, ally]);
    // Hand effective total: 3 + 7 + max(0, 1 + -4=−3→0) = 10. The negative-effective card floors at 0.
    state.players.bottom.hand = [
      instance(def("A", 1, 3), "bottom"),
      instance(def("B", 1, 7), "bottom"),
      instance(def("C", 1, 1, undefined), "bottom", -4),
    ];
    const before = {
      destroyedPower: state.destroyedPower,
      destroyedCount: state.destroyedCount,
    };
    const { state: after, events } = endTurn(state, mulberry32(1));
    expect(after.players.bottom.hand.length).toBe(0); // whole hand gone
    // Hand destruction now FEEDS Stella: +summed effective power, +hand size.
    expect(after.destroyedPower).toBe(before.destroyedPower + 10);
    expect(after.destroyedCount).toBe(before.destroyedCount + 3);
    // The +10 is spread across ALL friendly board cards (Moonlit + ally); the total bonus added = 10.
    const moonAfter = find(after, moonlit.uid)!;
    const allyAfter = find(after, ally.uid)!;
    expect(moonAfter.bonus + allyAfter.bonus).toBe(10);
    expect(events.some((e) => e.type === "ability")).toBe(true);
  });

  it("empty hand is a no-op (no ability event, no bonus change)", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const moonlit = instance(def("MOON", 6, 4, moonlitSacrifice()), "bottom");
    setLane(state, 0, [null, null, moonlit]);
    const { state: after, events } = endTurn(state, mulberry32(1));
    expect(find(after, moonlit.uid)!.bonus).toBe(0);
    expect(
      events.some((e) => e.type === "ability" && e.card?.id === moonlit.def.id),
    ).toBe(false);
  });

  it("is deterministic for equal seeds (same random target)", () => {
    const build = () => {
      const state = emptyGame("bottom");
      state.active = "bottom";
      const moonlit = instance(def("MOON", 6, 4, moonlitSacrifice()), "bottom");
      setLane(state, 0, [null, null, moonlit]);
      setLane(state, 1, [null, null, instance(def("X", 1, 1), "bottom")]);
      setLane(state, 2, [null, null, instance(def("Y", 1, 1), "bottom")]);
      state.players.bottom.hand = [instance(def("H", 1, 5), "bottom")];
      return state;
    };
    const a = endTurn(build(), mulberry32(7));
    const b = endTurn(build(), mulberry32(7));
    const bonuses = (s: GameState) =>
      onBoard(s)
        .map((c) => c.bonus)
        .sort((x, y) => x - y);
    expect(bonuses(a.state)).toEqual(bonuses(b.state));
  });
});

// =============================================================================
// Wild Eyes (wildShift)
// =============================================================================
describe("Wild Eyes / wildShift", () => {
  it("relocates one random other card in its lane to another lane with room (one moved)", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const wild = instance(def("WILD", 4, 4, wildShift()), "bottom");
    const other = instance(def("OTH", 1, 1), "bottom");
    setLane(state, 0, [null, wild, other]);
    const { state: after, events } = endTurn(state, mulberry32(1));
    const moves = movedEvents(events);
    expect(moves.length).toBe(1);
    expect(moves[0].uid).toBe(other.uid);
    // The moved card is no longer in lane 0.
    const lane0 = after.lanes[0].map((c) => c?.uid ?? null);
    expect(lane0).not.toContain(other.uid);
  });

  it("no other card in the lane → no-op", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const wild = instance(def("WILD", 4, 4, wildShift()), "bottom");
    setLane(state, 0, [null, null, wild]);
    const { events } = endTurn(state, mulberry32(1));
    expect(movedEvents(events).length).toBe(0);
  });

  it("both other lanes full for that owner → no-op", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const wild = instance(def("WILD", 4, 4, wildShift()), "bottom");
    const other = instance(def("OTH", 1, 1), "bottom");
    setLane(state, 0, [null, wild, other]);
    // Fill lanes 1 and 2 completely (no empty cell for any owner side).
    setLane(state, 1, [
      instance(def("F1", 1, 1), "bottom"),
      instance(def("F2", 1, 1), "bottom"),
      instance(def("F3", 1, 1), "bottom"),
    ]);
    setLane(state, 2, [
      instance(def("G1", 1, 1), "bottom"),
      instance(def("G2", 1, 1), "bottom"),
      instance(def("G3", 1, 1), "bottom"),
    ]);
    const { events } = endTurn(state, mulberry32(1));
    expect(movedEvents(events).length).toBe(0);
  });
});

// =============================================================================
// Titan Eyes (titanShift)
// =============================================================================
describe("Titan Eyes / titanShift", () => {
  it("moves every other card in its lane to one random other lane; Titan unmoved; each emits moved", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const titan = instance(def("TTN", 4, 10, titanShift()), "bottom");
    const a = instance(def("A", 1, 1), "bottom");
    const b = instance(def("B", 1, 1), "bottom");
    setLane(state, 0, [a, b, titan]);
    const { state: after, events } = endTurn(state, mulberry32(1));
    const moves = movedEvents(events);
    expect(moves.length).toBe(2);
    expect(new Set(moves.map((m) => m.uid))).toEqual(new Set([a.uid, b.uid]));
    // Titan stayed put in lane 0.
    expect(find(after, titan.uid)!).toBeTruthy();
    expect(after.lanes[0].some((c) => c?.uid === titan.uid)).toBe(true);
    expect(after.lanes[0].some((c) => c?.uid === a.uid)).toBe(false);
    expect(after.lanes[0].some((c) => c?.uid === b.uid)).toBe(false);
  });

  it("overflow cards stay (no destruction) when the destination lane fills", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const titan = instance(def("TTN", 4, 10, titanShift()), "bottom");
    const a = instance(def("A", 1, 1), "bottom");
    const b = instance(def("B", 1, 1), "bottom");
    setLane(state, 0, [a, b, titan]);
    // Seed 7 → Titan picks otherLanes(0)[0] = lane 1. Give lane 1 exactly ONE empty cell and fill
    // lane 2, so only one of a/b fits and the other must stay (no destruction).
    setLane(state, 1, [
      instance(def("P1", 1, 1), "bottom"),
      instance(def("P2", 1, 1), "bottom"),
      null,
    ]);
    setLane(state, 2, [
      instance(def("Q1", 1, 1), "bottom"),
      instance(def("Q2", 1, 1), "bottom"),
      instance(def("Q3", 1, 1), "bottom"),
    ]);
    const { state: after, events } = endTurn(state, mulberry32(7));
    // Only one of a/b fit into lane 1's single empty cell; the other stays in lane 0. No card lost.
    const moves = movedEvents(events);
    expect(moves.length).toBe(1);
    expect(find(after, a.uid)).toBeTruthy();
    expect(find(after, b.uid)).toBeTruthy();
  });
});

// =============================================================================
// Apex Eyes (apexSwap)
// =============================================================================
describe("Apex Eyes / apexSwap", () => {
  it("bottom owner swaps with the frontmost friendly card (toward the enemy edge), two moved", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    // Bottom's enemy edge is cell 0. Front friendly is at cell 0; Apex sits at cell 2.
    const front = instance(def("FRONT", 1, 1), "bottom");
    const apex = instance(def("APEX", 4, 12, apexSwap()), "bottom");
    setLane(state, 0, [front, null, apex]);
    const { state: after, events } = endTurn(state, mulberry32(1));
    const moves = movedEvents(events);
    expect(moves.length).toBe(2);
    // Apex moved to cell 0, front moved to cell 2.
    expect(after.lanes[0][0]?.uid).toBe(apex.uid);
    expect(after.lanes[0][2]?.uid).toBe(front.uid);
  });

  it("top owner swaps with the frontmost friendly card toward its enemy edge (cell 2)", () => {
    const state = emptyGame("top");
    state.active = "top";
    // Top's enemy edge is cell 2. Front friendly is at cell 2; Apex sits at cell 0.
    const apex = instance(def("APEX", 4, 12, apexSwap()), "top");
    const front = instance(def("FRONT", 1, 1), "top");
    setLane(state, 0, [apex, null, front]);
    const { state: after, events } = endTurn(state, mulberry32(1));
    expect(movedEvents(events).length).toBe(2);
    expect(after.lanes[0][2]?.uid).toBe(apex.uid);
    expect(after.lanes[0][0]?.uid).toBe(front.uid);
  });

  it("no-op when Apex is already the frontmost friendly card", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const apex = instance(def("APEX", 4, 12, apexSwap()), "bottom");
    const back = instance(def("BACK", 1, 1), "bottom");
    // Apex at cell 0 (enemy edge) is already frontmost; another friendly behind it.
    setLane(state, 0, [apex, null, back]);
    const { events } = endTurn(state, mulberry32(1));
    expect(movedEvents(events).length).toBe(0);
  });

  it("no-op when Apex is the only friendly card in the lane", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const apex = instance(def("APEX", 4, 12, apexSwap()), "bottom");
    const enemy = instance(def("ENEMY", 1, 1), "top");
    setLane(state, 0, [enemy, null, apex]);
    const { events } = endTurn(state, mulberry32(1));
    expect(movedEvents(events).length).toBe(0);
  });
});

// =============================================================================
// Berserk Eyes (berserkKill)
// =============================================================================
describe("Berserk Eyes / berserkKill", () => {
  it("destroys the card directly in front (enemy victim) and tallies it", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    // Bottom's front is one step toward cell 0. Berserk at cell 2, victim at cell 1.
    const berserk = instance(def("BSK", 4, 4, berserkKill()), "bottom");
    const victim = instance(def("VIC", 1, 6), "top");
    setLane(state, 0, [null, victim, berserk]);
    const { state: after } = endTurn(state, mulberry32(1));
    expect(find(after, victim.uid)).toBeUndefined();
    expect(after.destroyedPower).toBe(6);
    expect(after.destroyedCount).toBe(1);
  });

  it("destroys a friendly card in front too", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const berserk = instance(def("BSK", 4, 4, berserkKill()), "bottom");
    const friend = instance(def("FRN", 1, 3), "bottom");
    setLane(state, 0, [null, friend, berserk]);
    const { state: after } = endTurn(state, mulberry32(1));
    expect(find(after, friend.uid)).toBeUndefined();
    expect(after.destroyedCount).toBe(1);
  });

  it("routes through destroyCard: a Phoenix victim rebirths into hand (not tallied)", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const berserk = instance(def("BSK", 4, 4, berserkKill()), "bottom");
    const phx = instance(def("PHX", 3, 3, phoenix(4)), "top");
    setLane(state, 0, [null, phx, berserk]);
    const beforeCount = state.destroyedCount;
    const { state: after } = endTurn(state, mulberry32(1));
    // Removed from board, but Phoenix dodges the tally and returns to its owner's hand.
    expect(find(after, phx.uid)).toBeUndefined();
    expect(after.destroyedCount).toBe(beforeCount); // not tallied
    expect(after.players.top.hand.some((c) => c.def.id === "PHX")).toBe(true);
  });

  it("empty front cell → no-op", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const berserk = instance(def("BSK", 4, 4, berserkKill()), "bottom");
    setLane(state, 0, [null, null, berserk]); // nothing in cell 1
    const { state: after } = endTurn(state, mulberry32(1));
    expect(after.destroyedCount).toBe(0);
  });

  it("Berserk at the enemy edge (no cell in front) → no-op", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    // Bottom's enemy edge is cell 0 → step −1 goes off-board.
    const berserk = instance(def("BSK", 4, 4, berserkKill()), "bottom");
    const other = instance(def("OTH", 1, 1), "bottom");
    setLane(state, 0, [berserk, null, other]);
    const { state: after } = endTurn(state, mulberry32(1));
    expect(after.destroyedCount).toBe(0);
    expect(find(after, other.uid)).toBeTruthy();
  });
});

// =============================================================================
// Wicked Eyes (wicked) — self-only, +2 once per turn, end of turn
// =============================================================================
describe("Wicked Eyes / wicked", () => {
  it("gains exactly +2 when its own position moved this turn", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const wick = instance(
      def("WIK", 2, 2, { timing: "continuous", effect: { kind: "wicked" } }),
      "bottom",
    );
    const titan = instance(def("TTN", 4, 10, titanShift()), "bottom");
    setLane(state, 0, [null, wick, titan]); // Titan relocates Wicked (its only lane-mate)
    const { state: after, events } = endTurn(state, mulberry32(1));
    expect(movedEvents(events).some((m) => m.uid === wick.uid)).toBe(true);
    expect(find(after, wick.uid)!.bonus).toBe(2);
  });

  it("does not gain when it did not move", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const wick = instance(
      def("WIK", 2, 2, { timing: "continuous", effect: { kind: "wicked" } }),
      "bottom",
    );
    setLane(state, 2, [null, null, wick]);
    const { state: after } = endTurn(state, mulberry32(1));
    expect(find(after, wick.uid)!.bonus).toBe(0);
  });

  it("does not stack beyond +2 when moved more than once in a turn", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const wick = instance(
      def("WIK", 2, 2, { timing: "continuous", effect: { kind: "wicked" } }),
      "bottom",
    );
    // Two Titans in Wicked's lane: the first relocates Wicked to another lane; a second Titan in
    // THAT destination lane relocates it again. Wicked moves twice but gains only +2 total.
    const t1 = instance(def("T1", 4, 10, titanShift()), "bottom");
    const t2 = instance(def("T2", 4, 10, titanShift()), "bottom");
    setLane(state, 0, [null, wick, t1]);
    // Seed 7 → t1 (lane 0) picks otherLanes(0)[0] = lane 1, where t2 waits. t1 relocates Wicked to
    // lane 1; t2 then relocates Wicked a second time. Wicked moves twice but gains only +2 total.
    setLane(state, 1, [null, null, t2]);
    const { state: after, events } = endTurn(state, mulberry32(7));
    const wickMoves = movedEvents(events).filter((m) => m.uid === wick.uid);
    expect(wickMoves.length).toBe(2); // genuinely displaced twice this turn
    expect(find(after, wick.uid)!.bonus).toBe(2); // still capped at +2
  });
});

// =============================================================================
// Move convention + determinism
// =============================================================================
describe("move convention", () => {
  it("a single relocate emits one moved; an Apex swap emits exactly two", () => {
    // Single relocate via Wild.
    const wildState = emptyGame("bottom");
    wildState.active = "bottom";
    const wild = instance(def("WILD", 4, 4, wildShift()), "bottom");
    setLane(wildState, 0, [null, instance(def("OTH", 1, 1), "bottom"), wild]);
    expect(movedEvents(endTurn(wildState, mulberry32(1)).events).length).toBe(
      1,
    );

    // Swap via Apex.
    const apexState = emptyGame("bottom");
    apexState.active = "bottom";
    const apex = instance(def("APEX", 4, 12, apexSwap()), "bottom");
    setLane(apexState, 0, [instance(def("FRONT", 1, 1), "bottom"), null, apex]);
    expect(movedEvents(endTurn(apexState, mulberry32(1)).events).length).toBe(
      2,
    );
  });

  it("Titan destination is deterministic for equal seeds", () => {
    const build = () => {
      const state = emptyGame("bottom");
      state.active = "bottom";
      const titan = instance(def("TTN", 4, 10, titanShift()), "bottom");
      setLane(state, 0, [
        instance(def("A", 1, 1), "bottom"),
        instance(def("B", 1, 1), "bottom"),
        titan,
      ]);
      return state;
    };
    const laneOf = (s: GameState, id: string): LaneIndex => {
      for (let l = 0; l < 3; l++)
        if (s.lanes[l].some((c) => c?.def.id === id)) return l as LaneIndex;
      throw new Error(`missing ${id}`);
    };
    const a = endTurn(build(), mulberry32(42)).state;
    const b = endTurn(build(), mulberry32(42)).state;
    expect(laneOf(a, "A")).toBe(laneOf(b, "A"));
    expect(laneOf(a, "B")).toBe(laneOf(b, "B"));
  });
});

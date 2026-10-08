import { describe, expect, it } from "vitest";
import { abilityText } from "../src/engine/abilities";
import { canPlay, effectiveCost, playCard } from "../src/engine/rules";
import type {
  Ability,
  CardInstance,
  Cell,
  GameState,
  LaneIndex,
} from "../src/engine/types";
import { mulberry32 } from "../src/util/rng";
import { pushBeatFired } from "../src/discord/battle-session";
import { def, emptyGame, give, instance, setLane } from "./engine-helpers";

// Ability constructors for the six new cards (mirror their shorthand in cards.json).
const phantom = (): Ability => ({
  timing: "active",
  effect: { kind: "shuffleRedraw" },
});
const oracle = (amount = 2): Ability => ({
  timing: "active",
  effect: { kind: "buffRowAll", amount },
});
const phasing = (): Ability => ({
  timing: "continuous",
  effect: { kind: "phasing" },
});
const wicked = (): Ability => ({
  timing: "continuous",
  effect: { kind: "wicked" },
});
const reflecting = (): Ability => ({
  timing: "continuous",
  effect: { kind: "reflecting" },
});
const gentle = (amount = 1): Ability => ({
  timing: "continuous",
  effect: { kind: "costReduction", amount },
});

const onBoard = (state: GameState): CardInstance[] =>
  state.lanes.flat().filter((c): c is CardInstance => c !== null);
const findByOwner = (state: GameState, idPrefix: string) =>
  onBoard(state).filter((c) => c.def.id.startsWith(idPrefix));

/** Plays a card from `seat`'s hand into `lane`, paying its cost (optionally with an explicit rng). */
function play(
  state: GameState,
  seat: "bottom" | "top",
  card: ReturnType<typeof def>,
  lane: LaneIndex,
  rng = mulberry32(123),
): { state: GameState; events: ReturnType<typeof playCard>["events"] } {
  const c = give(state, seat, card);
  state.players[seat].energy = Math.max(state.players[seat].energy, card.cost);
  return playCard(state, c.uid, lane, rng);
}

// --- Gentle / effectiveCost ---------------------------------------------------

describe("Gentle Eyes / effectiveCost", () => {
  it("reduces a bottom card's cost by 1 per Gentle on the board, floored at 0", () => {
    const state = emptyGame();
    const card = def("X", 3, 3);
    expect(effectiveCost(state, "bottom", card)).toBe(3);

    setLane(state, 0, [
      null,
      null,
      instance(def("G1", 6, 4, gentle()), "bottom"),
    ]);
    expect(effectiveCost(state, "bottom", card)).toBe(2);

    setLane(state, 1, [
      null,
      null,
      instance(def("G2", 6, 4, gentle()), "bottom"),
    ]);
    expect(effectiveCost(state, "bottom", card)).toBe(1);

    // A third Gentle floors the cost at 0, never negative.
    setLane(state, 2, [
      null,
      null,
      instance(def("G3", 6, 4, gentle()), "bottom"),
    ]);
    expect(effectiveCost(state, "bottom", def("Y", 2, 2))).toBe(0);
  });

  it("only reduces the owner's cards, not the enemy's", () => {
    const state = emptyGame();
    setLane(state, 0, [
      null,
      null,
      instance(def("G1", 6, 4, gentle()), "bottom"),
    ]);
    const card = def("X", 3, 3);
    expect(effectiveCost(state, "bottom", card)).toBe(2);
    expect(effectiveCost(state, "top", card)).toBe(3);
  });

  it("canPlay passes a card the player could not afford at full cost", () => {
    const state = emptyGame();
    setLane(state, 0, [
      null,
      null,
      instance(def("G1", 6, 4, gentle()), "bottom"),
    ]);
    state.active = "bottom";
    state.players.bottom.energy = 2; // below base cost 3, at/above effective cost 2
    const c = give(state, "bottom", def("X", 3, 3));
    expect(canPlay(state, c.uid, 1).ok).toBe(true);
  });

  it("playCard charges the reduced cost", () => {
    const state = emptyGame();
    setLane(state, 0, [
      null,
      null,
      instance(def("G1", 6, 4, gentle()), "bottom"),
    ]);
    state.active = "bottom";
    state.players.bottom.energy = 5;
    const c = give(state, "bottom", def("X", 3, 3));
    const { state: after } = playCard(state, c.uid, 1);
    expect(after.players.bottom.energy).toBe(5 - 2); // charged effective cost 2, not 3
  });

  it("renders the Passive cost-reduction text", () => {
    expect(abilityText(gentle(1))).toBe(
      "Passive: Your cards cost 1 less (minimum 0).",
    );
    expect(abilityText(gentle(2))).toBe(
      "Passive: Your cards cost 2 less (minimum 0).",
    );
  });
});

// --- Oracle Eyes --------------------------------------------------------------

describe("Oracle Eyes / buffRowAll", () => {
  it("gives +2 to every card in the ROW (same cell index across lanes) including itself and the enemy, leaving other cells untouched", () => {
    const state = emptyGame();
    state.active = "bottom";
    // Oracle plays bottom into lane 1 → lands at cell 2 (bottom entry). The buffed ROW is cell 2
    // across all three lanes. Put positive probes at cell 2 in the two OTHER lanes (no entry push
    // there): one own (lane 0), one enemy (lane 2). Lane 0 also carries a negative probe at cell 0.
    setLane(state, 0, [
      instance(def("OTHER_CELL", 1, 1), "bottom"), // cell 0: different cell index → not in the row
      null,
      instance(def("ROW_OWN", 1, 1), "bottom"), // cell 2: in the row → buffed
    ]);
    setLane(state, 2, [null, null, instance(def("ROW_FOE", 1, 1), "top")]);
    // In Oracle's OWN lane (lane 1), a card at cell 0 (not shoved to cell 2) must NOT be buffed.
    setLane(state, 1, [
      instance(def("OWN_LANE_C0", 1, 1), "bottom"),
      null,
      null,
    ]);

    const { state: after } = play(
      state,
      "bottom",
      def("ORA", 1, 2, oracle()),
      1,
    );

    const rowOwn = onBoard(after).find((c) => c.def.id === "ROW_OWN")!;
    const rowFoe = onBoard(after).find((c) => c.def.id === "ROW_FOE")!;
    const ora = onBoard(after).find((c) => c.def.id === "ORA")!;
    expect(rowOwn.bonus).toBe(2); // own card at cell 2 in another lane
    expect(rowFoe.bonus).toBe(2); // enemy card at cell 2 buffed too
    expect(ora.bonus).toBe(2); // Oracle buffs itself (cell 2 of its own lane)

    // Different cell index in another lane: not in the row, not buffed.
    expect(onBoard(after).find((c) => c.def.id === "OTHER_CELL")!.bonus).toBe(
      0,
    );
    // Oracle's own lane, cell 0: not in the row, not buffed (inverts the old whole-column buff).
    expect(onBoard(after).find((c) => c.def.id === "OWN_LANE_C0")!.bonus).toBe(
      0,
    );
  });

  it("renders the mandatory Oracle active text", () => {
    expect(abilityText(oracle(2))).toBe(
      "Active: Every card in this row gets +2 power.",
    );
  });
});

// --- Phantom Eyes -------------------------------------------------------------

describe("Phantom Eyes / shuffleRedraw", () => {
  it("redraws to the post-play hand size and preserves the hand+deck multiset", () => {
    const state = emptyGame();
    state.active = "bottom";
    state.players.bottom.energy = 3;
    // Hand (besides Phantom): 3 cards. Deck: 4 cards.
    const handDefs = [def("h1", 1, 1), def("h2", 1, 1), def("h3", 1, 1)];
    for (const d of handDefs) give(state, "bottom", d);
    state.players.bottom.deck = [
      def("d1", 1, 1),
      def("d2", 1, 1),
      def("d3", 1, 1),
      def("d4", 1, 1),
    ];
    const phantomInst = give(state, "bottom", def("PHA", 3, 6, phantom()));

    const poolIds = [
      ...handDefs.map((d) => d.id),
      ...state.players.bottom.deck.map((d) => d.id),
    ].sort();

    const { state: after } = playCard(state, phantomInst.uid, 1, mulberry32(7));

    // Post-play hand size (before shuffle) was 3 → redraw to 3.
    expect(after.players.bottom.hand.length).toBe(3);
    // Deck+hand multiset preserved (Phantom itself is on the board, excluded).
    const afterIds = [
      ...after.players.bottom.hand.map((c) => c.def.id),
      ...after.players.bottom.deck.map((d) => d.id),
    ].sort();
    expect(afterIds).toEqual(poolIds);
    // Phantom is on the board, not in hand/deck.
    expect(afterIds).not.toContain("PHA");
  });

  it("leaves board cards untouched", () => {
    const state = emptyGame();
    state.active = "bottom";
    state.players.bottom.energy = 3;
    setLane(state, 0, [null, null, instance(def("BOARD", 1, 9), "bottom", 3)]);
    state.players.bottom.deck = [def("d1", 1, 1), def("d2", 1, 1)];
    const phantomInst = give(state, "bottom", def("PHA", 3, 6, phantom()));

    const { state: after } = playCard(state, phantomInst.uid, 1, mulberry32(5));
    const board = onBoard(after).find((c) => c.def.id === "BOARD")!;
    expect(board.bonus).toBe(3);
  });

  it("is deterministic for equal seeds", () => {
    const build = () => {
      const state = emptyGame();
      state.active = "bottom";
      state.players.bottom.energy = 3;
      for (const d of [def("h1", 1, 1), def("h2", 1, 1)])
        give(state, "bottom", d);
      state.players.bottom.deck = [
        def("d1", 1, 1),
        def("d2", 1, 1),
        def("d3", 1, 1),
      ];
      const p = give(state, "bottom", def("PHA", 3, 6, phantom()));
      return { state, uid: p.uid };
    };
    const a = build();
    const b = build();
    const ra = playCard(a.state, a.uid, 1, mulberry32(42)).state;
    const rb = playCard(b.state, b.uid, 1, mulberry32(42)).state;
    expect(rb.players.bottom.hand.map((c) => c.def.id)).toEqual(
      ra.players.bottom.hand.map((c) => c.def.id),
    );
    expect(rb.players.bottom.deck.map((d) => d.id)).toEqual(
      ra.players.bottom.deck.map((d) => d.id),
    );
  });

  it("renders the mandatory Phantom active text", () => {
    expect(abilityText(phantom())).toBe(
      "Active: Shuffle your hand into your deck, then draw that many cards.",
    );
  });
});

// --- Phasing Eyes -------------------------------------------------------------

describe("Phasing Eyes / phasing", () => {
  it("relocates to a random empty lane when an enemy push would destroy it, emitting a moved event", () => {
    const state = emptyGame();
    state.active = "top";
    // Lane 0 full. Top enters at cell 0 and pushes toward the far edge (cell 2), so the card at cell 2
    // falls off. Phasing (bonus 2) sits at the far cell 2 → it would be destroyed. Lanes 1 & 2 empty →
    // relocation target.
    const phasingInst = instance(def("PHS", 2, 3, phasing()), "bottom", 2);
    setLane(state, 0, [
      instance(def("M", 1, 1), "bottom"),
      instance(def("N", 1, 1), "bottom"),
      phasingInst,
    ]);
    const before = state.destroyedCount;

    const { state: after, events } = play(
      state,
      "top",
      def("ATK", 1, 1),
      0,
      mulberry32(3),
    );

    const moved = events.filter((e) => e.type === "moved");
    expect(moved.length).toBe(1);
    expect(after.destroyedCount).toBe(before); // not destroyed
    const relocated = onBoard(after).find((c) => c.uid === phasingInst.uid)!;
    expect(relocated).toBeDefined();
    expect(relocated.owner).toBe("bottom");
    expect(relocated.bonus).toBe(2); // uid/owner/bonus preserved
    // It landed in one of the previously-empty lanes (1 or 2), not lane 0.
    const laneOf = after.lanes.findIndex((l) =>
      l.some((c) => c?.uid === phasingInst.uid),
    );
    expect([1, 2]).toContain(laneOf);
  });

  it("is destroyed normally when no lane is empty", () => {
    const state = emptyGame();
    state.active = "top";
    const phasingInst = instance(def("PHS", 2, 3, phasing()), "bottom");
    setLane(state, 0, [
      instance(def("M", 1, 1), "bottom"),
      instance(def("N", 1, 1), "bottom"),
      phasingInst,
    ]);
    // Occupy lanes 1 and 2 so no empty lane exists.
    setLane(state, 1, [null, null, instance(def("B1", 1, 1), "bottom")]);
    setLane(state, 2, [null, null, instance(def("B2", 1, 1), "bottom")]);
    const before = state.destroyedCount;

    const { state: after, events } = play(state, "top", def("ATK", 1, 1), 0);

    expect(events.some((e) => e.type === "moved")).toBe(false);
    expect(after.destroyedCount).toBe(before + 1); // destroyed
    expect(
      onBoard(after).find((c) => c.uid === phasingInst.uid),
    ).toBeUndefined();
  });
});

// --- Wicked Eyes --------------------------------------------------------------

describe("Wicked Eyes / wicked", () => {
  it("gains +1 power per moved event in the action (from either seat)", () => {
    const state = emptyGame();
    state.active = "top";
    // A Phasing relocate (one moved event) with a Wicked on the board.
    const wickedInst = instance(def("WIK", 4, 7, wicked()), "bottom");
    setLane(state, 2, [null, null, wickedInst]);
    const phasingInst = instance(def("PHS", 2, 3, phasing()), "bottom");
    setLane(state, 0, [
      instance(def("M", 1, 1), "bottom"),
      instance(def("N", 1, 1), "bottom"),
      phasingInst,
    ]);
    // Lane 1 empty → Phasing relocates there, emitting one moved event.

    const { state: after, events } = play(
      state,
      "top",
      def("ATK", 1, 1),
      0,
      mulberry32(1),
    );

    expect(events.filter((e) => e.type === "moved").length).toBe(1);
    const wik = onBoard(after).find((c) => c.uid === wickedInst.uid)!;
    expect(wik.bonus).toBe(1);
  });
});

// --- Reflecting Eyes ----------------------------------------------------------

describe("Reflecting Eyes / reflecting", () => {
  it("shoves a random other lane one step when an enemy push displaces it (can destroy)", () => {
    const state = emptyGame();
    state.active = "top";
    // Reflecting is bottom-owned in lane 0; a top play into lane 0 shoves the column, displacing it.
    const reflInst = instance(def("REF", 4, 6, reflecting()), "bottom");
    setLane(state, 0, [reflInst, null, instance(def("P", 1, 1), "bottom")]);
    // One other lane holds an enemy card at the far edge (cell 0 for a top-owned card is its own
    // edge; a bottom-actor phantom push toward cell 0 shoves a top card toward the top edge).
    setLane(state, 1, [instance(def("VIC", 1, 1), "top"), null, null]);
    setLane(state, 2, [instance(def("VIC2", 1, 1), "top"), null, null]);
    const before = state.destroyedCount;

    const { state: after, events } = play(
      state,
      "top",
      def("ATK", 1, 1),
      0,
      mulberry32(2),
    );

    // Exactly one phantom-push reaction fired (the Reflecting answer ability line).
    const answers = events.filter(
      (e) =>
        e.type === "ability" &&
        (e.text === "pushed another lane in answer" ||
          e.text === "rippled an empty lane"),
    );
    expect(answers.length).toBe(1);
    // Reflecting was displaced (moved to a different cell or off), so the beat changed the board.
    expect(after.destroyedCount).toBeGreaterThanOrEqual(before);
  });

  it("no-ops with an ability event when the targeted lane is empty", () => {
    const state = emptyGame();
    state.active = "top";
    const reflInst = instance(def("REF", 4, 6, reflecting()), "bottom");
    setLane(state, 0, [reflInst, null, instance(def("P", 1, 1), "bottom")]);
    // Both other lanes empty → phantom push is a no-op shove + "rippled an empty lane" event.

    const { events } = play(state, "top", def("ATK", 1, 1), 0, mulberry32(9));
    const ripples = events.filter(
      (e) => e.type === "ability" && e.text === "rippled an empty lane",
    );
    expect(ripples.length).toBe(1);
  });

  it("terminates on a chain of Reflecting + Phasing in the ripple path", () => {
    const state = emptyGame();
    state.active = "top";
    // Reflecting in lane 0 (displaced by the entry push).
    const reflInst = instance(def("REF", 4, 6, reflecting()), "bottom");
    setLane(state, 0, [reflInst, null, instance(def("P", 1, 1), "bottom")]);
    // Lanes 1 & 2 each hold a Phasing card at the far edge, so the phantom push can shove one off and
    // Phasing may relocate — exercising the recursion path. Must terminate.
    setLane(state, 1, [
      instance(def("PHS1", 2, 3, phasing()), "top"),
      null,
      null,
    ]);
    setLane(state, 2, [
      instance(def("PHS2", 2, 3, phasing()), "top"),
      null,
      null,
    ]);

    expect(() =>
      play(state, "top", def("ATK", 1, 1), 0, mulberry32(4)),
    ).not.toThrow();
  });
});

// --- after-push gate predicate (pushBeatFired) --------------------------------

describe("after-push gate (pushBeatFired)", () => {
  const movedEvent = {
    type: "moved" as const,
    seat: "bottom" as const,
    uid: 1,
    card: def("C", 1, 1),
    from: { lane: 0 as LaneIndex, cell: 2 },
    to: { lane: 1 as LaneIndex, cell: 2 },
  };
  const pushKill = {
    type: "played" as const,
    seat: "bottom" as const,
    uid: 2,
    card: def("C", 1, 1),
    lane: 0 as LaneIndex,
    destroyed: { card: def("D", 1, 1), owner: "top" as const },
  };

  it("fires for a moved-carrying step (Phasing)", () => {
    expect(pushBeatFired([movedEvent], 0, 0)).toBe(true);
  });

  it("fires for a phantom-push/Siren kill delta with no played.destroyed", () => {
    expect(pushBeatFired([], 1, 2)).toBe(true);
  });

  it("fires for a plain entry-push kill (hasPush)", () => {
    expect(pushBeatFired([pushKill], 0, 1)).toBe(true);
  });

  it("does not fire for a no-op play", () => {
    const plainPlay = {
      type: "played" as const,
      seat: "bottom" as const,
      uid: 3,
      card: def("C", 1, 1),
      lane: 0 as LaneIndex,
      destroyed: null,
    };
    expect(pushBeatFired([plainPlay], 0, 0)).toBe(false);
  });

  // HIGH-1 regression: the AI/playback loop must seed prevDestroyed from the PRE-AI-TURN baseline, not
  // from the post-reassignment finalState count. A beat whose events carry NEITHER played.destroyed NOR
  // moved, but whose destroyedCount rose above the pre-turn baseline, must fire the after-push beat.
  it("AI-side: fires against the correct pre-turn baseline, but would be missed against the post-turn count", () => {
    const startDestroyed = 0; // pre-AI-turn baseline
    const finalDestroyed = 1; // playback.finalState count (post-turn maximum)
    const beatEvents: never[] = []; // Reflecting/Siren kill: no played.destroyed, no moved
    const beatDestroyedCount = 1; // this beat raised the count to 1

    // Correct seed (pre-turn baseline): the gate fires.
    expect(pushBeatFired(beatEvents, startDestroyed, beatDestroyedCount)).toBe(
      true,
    );
    // Regression: seeding from the post-reassignment finalState count makes the SAME beat's gate false.
    expect(pushBeatFired(beatEvents, finalDestroyed, beatDestroyedCount)).toBe(
      false,
    );
  });
});

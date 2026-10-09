import { describe, expect, it } from "vitest";
import {
  canPlay,
  effectivePower,
  endTurn,
  playCard,
  totalPower,
} from "../src/engine/rules";
import type {
  Ability,
  CardInstance,
  Cell,
  GameState,
  LaneIndex,
} from "../src/engine/types";
import { mulberry32 } from "../src/util/rng";
import { def, emptyGame, give, instance, setLane } from "./engine-helpers";

// Ability constructors for the seven designed cards (mirrors their shorthand in cards.json).
const stella = (): Ability => ({
  timing: "active",
  effect: { kind: "destroyedPower" },
});
const bedrock = (): Ability => ({
  timing: "continuous",
  effect: { kind: "pushImmune" },
});
const phoenix = (): Ability => ({
  timing: "onDestroy",
  effect: { kind: "rebirth", amount: 4 },
});
const venom = (): Ability => ({
  timing: "continuous",
  effect: { kind: "drainStartOfTurn", amount: 1 },
});
const ocean = (): Ability => ({
  timing: "endOfRound",
  effect: { kind: "oceanReturn", amount: 1 },
});
const siren = (): Ability => ({
  timing: "active",
  effect: { kind: "pushLane" },
});
const laser = (): Ability => ({
  timing: "active",
  effect: { kind: "destroyLane" },
});

const names = (lane: readonly Cell[]) => lane.map((c) => c?.def.id ?? "-");
const onBoard = (state: GameState): CardInstance[] =>
  state.lanes.flat().filter((c): c is CardInstance => c !== null);

/** Plays a card from `seat`'s hand into `lane`, paying its cost. */
function play(
  state: GameState,
  seat: "bottom" | "top",
  card: ReturnType<typeof def>,
  lane: LaneIndex,
): GameState {
  const c = give(state, seat, card);
  state.players[seat].energy = Math.max(state.players[seat].energy, card.cost);
  return playCard(state, c.uid, lane).state;
}

describe("destroyCard tally + Phoenix revive", () => {
  it("adds the actual power of a destroyed card to the tally", () => {
    const state = emptyGame();
    // A full enemy lane; playing X pushes the far enemy card (power 7) off the edge.
    setLane(state, 0, [
      instance(def("E1", 1, 7), "top"),
      instance(def("E2", 1, 1), "top"),
      instance(def("P1", 1, 1), "bottom"),
    ]);
    const after = play(state, "bottom", def("X", 1, 1), 0);
    expect(after.destroyedPower).toBe(7);
  });

  it("counts a Venom-negative card as 0 power in the tally", () => {
    const state = emptyGame();
    setLane(state, 0, [
      instance(def("E1", 1, 2), "top", -5), // effective power floored at 0
      instance(def("E2", 1, 1), "top"),
      instance(def("P1", 1, 1), "bottom"),
    ]);
    const after = play(state, "bottom", def("X", 1, 1), 0);
    expect(after.destroyedPower).toBe(0);
  });

  it("Phoenix returns to its owner hand with +4 and is NOT counted in the tally", () => {
    const state = emptyGame();
    setLane(state, 0, [
      instance(def("PHX", 4, 4, phoenix()), "top"),
      instance(def("E2", 1, 1), "top"),
      instance(def("P1", 1, 1), "bottom"),
    ]);
    const after = play(state, "bottom", def("X", 1, 1), 0);
    expect(after.destroyedPower).toBe(0); // Phoenix not tallied
    const revived = after.players.top.hand.find((c) => c.def.id === "PHX");
    expect(revived).toBeDefined();
    expect(revived!.bonus).toBe(4);
    expect(revived!.uid).toBeGreaterThan(0);
  });

  it("a revived Phoenix can die again and stacks +4 additively without overflow", () => {
    const state = emptyGame();
    const phx = instance(def("PHX", 4, 4, phoenix()), "top", 4); // already revived once
    setLane(state, 0, [
      phx,
      instance(def("E2", 1, 1), "top"),
      instance(def("P1", 1, 1), "bottom"),
    ]);
    const after = play(state, "bottom", def("X", 1, 1), 0);
    const revived = after.players.top.hand.find((c) => c.def.id === "PHX");
    expect(revived!.bonus).toBe(8); // 4 + 4
    expect(after.destroyedPower).toBe(0);
  });
});

describe("Stella Eyes", () => {
  it("gains power equal to the destroyed-power tally when played", () => {
    const state = emptyGame();
    state.destroyedPower = 11;
    const after = play(state, "bottom", def("STELLA", 5, 0, stella()), 1);
    const stellaCard = after.lanes[1].find((c) => c?.def.id === "STELLA")!;
    expect(stellaCard.bonus).toBe(11);
    expect(effectivePower(after, 1, stellaCard)).toBe(11);
  });

  it("includes the card her own entry push just shoved off", () => {
    const state = emptyGame();
    state.destroyedPower = 3; // from earlier this match
    setLane(state, 0, [
      instance(def("E1", 1, 6), "top"),
      instance(def("E2", 1, 1), "top"),
      instance(def("P1", 1, 1), "bottom"),
    ]);
    const after = play(state, "bottom", def("STELLA", 5, 0, stella()), 0);
    const stellaCard = after.lanes[0].find((c) => c?.def.id === "STELLA")!;
    // destroyCard (push, +6) runs before applyActive, so Stella reads 3 + 6 = 9.
    expect(stellaCard.bonus).toBe(9);
  });
});

describe("Bedrock Eyes push immunity", () => {
  it("a full lane whose far-edge card is immune cannot be played into (the lane is blocked)", () => {
    const state = emptyGame("bottom");
    // bottom's far edge is cell 0. Full lane with the immune BED at the far edge.
    setLane(state, 0, [
      instance(def("BED", 3, 5, bedrock()), "top"),
      instance(def("MID", 1, 1), "top"),
      instance(def("MINE", 1, 1), "bottom"),
    ]);
    const x = give(state, "bottom", def("X", 1, 1));
    state.players.bottom.energy = 1;
    // The push would carry BED off the far edge; it is immune, so the push is absorbed and the card
    // cannot enter — the lane offers no legal placement.
    expect(canPlay(state, x.uid, 0)).toEqual({ ok: false, reason: "blocked" });
  });

  it("an immune card NOT yet at the far edge can still be pushed one step (lane stays playable)", () => {
    const state = emptyGame("bottom");
    // BED at cell 2 (bottom's entry side), gap ahead: a bottom play shoves it toward cell 1, no block.
    const bed = instance(def("BED", 3, 5, bedrock()), "bottom");
    setLane(state, 0, [null, null, bed]);
    const x = give(state, "bottom", def("X", 1, 1));
    state.players.bottom.energy = 1;
    expect(canPlay(state, x.uid, 0).ok).toBe(true);
    const after = playCard(state, x.uid, 0).state;
    expect(after.destroyedPower).toBe(0);
    expect(after.lanes[0][1]?.def.id).toBe("BED"); // slid one step, not destroyed
  });

  it("an enemy play into a lane holding a pushImmune card is legal, and the immune card is not destroyed", () => {
    const state = emptyGame("top"); // top is active (the enemy of the immune card's owner)
    const bed = instance(def("BED", 3, 5, bedrock()), "bottom");
    // top enters from cell 0; a full lane means the push chain reaches BED at the far edge (cell 2).
    setLane(state, 0, [
      instance(def("T0", 1, 1), "top"),
      instance(def("MID", 1, 1), "bottom"),
      bed,
    ]);
    const y = give(state, "top", def("Y", 1, 1));
    state.players.top.energy = 1;
    // The push into this lane would carry BED (immune) off the far edge, so it is absorbed and the
    // played card could not enter — the lane is forbidden (no legal placement).
    expect(canPlay(state, y.uid, 0)).toEqual({ ok: false, reason: "blocked" });
  });

  it("an OWNER push that would carry its own immune card off the far edge is also blocked (immunity is ownership-agnostic)", () => {
    const state = emptyGame("bottom");
    // bottom's far edge is cell 0: a full OWN lane with the immune BED at the far edge.
    setLane(state, 0, [
      instance(def("BED", 3, 5, bedrock()), "bottom"),
      instance(def("B", 1, 1), "bottom"),
      instance(def("A", 1, 1), "bottom"),
    ]);
    const x = give(state, "bottom", def("X", 1, 1));
    state.players.bottom.energy = 1;
    // The owner cannot shove its own immune card off, so this lane is forbidden too.
    expect(canPlay(state, x.uid, 0)).toEqual({ ok: false, reason: "blocked" });
  });

  it("a pushImmune card mid-lane with a gap ahead still slides one step when pushed", () => {
    const state = emptyGame("bottom");
    // bottom enters at cell 2; BED sits at cell 2 with a gap ahead (cell 1 empty), so it slides to cell 1.
    const bed = instance(def("BED", 3, 5, bedrock()), "bottom");
    setLane(state, 0, [null, null, bed]);
    const after = play(state, "bottom", def("X", 1, 1), 0);
    const moved = after.lanes[0].find((c) => c?.def.id === "BED")!;
    expect(moved.uid).toBe(bed.uid); // uid preserved across the slide
    expect(after.lanes[0][1]?.def.id).toBe("BED"); // slid from cell 2 to cell 1
    expect(after.destroyedPower).toBe(0);
  });

  it("Reflecting's phantom push does not destroy a pushImmune card at the far edge", () => {
    const state = emptyGame();
    state.active = "top";
    // Reflecting is bottom-owned in lane 0; a top play into lane 0 displaces it and fires a phantom
    // push on a RANDOM other lane. Put the immune wall in BOTH other lanes so whichever is picked,
    // the immune card survives (top's far edge is cell 2, with a card behind it at cell 1).
    const reflecting: Ability = {
      timing: "continuous",
      effect: { kind: "reflecting" },
    };
    const reflInst = instance(def("REF", 4, 6, reflecting), "bottom");
    setLane(state, 0, [reflInst, null, instance(def("P", 1, 1), "bottom")]);
    setLane(state, 1, [
      null,
      instance(def("BEHIND1", 1, 1), "top"),
      instance(def("BED", 3, 5, bedrock()), "top"),
    ]);
    setLane(state, 2, [
      null,
      instance(def("BEHIND2", 1, 1), "top"),
      instance(def("BED", 3, 5, bedrock()), "top"),
    ]);
    const atk = give(state, "top", def("ATK", 1, 1));
    state.players.top.energy = 1;
    const resolved = playCard(state, atk.uid, 0, mulberry32(2)).state;
    // Both candidate lanes still hold their immune BED; nothing fell off either.
    expect(resolved.lanes[1].some((c) => c?.def.id === "BED")).toBe(true);
    expect(resolved.lanes[2].some((c) => c?.def.id === "BED")).toBe(true);
    expect(resolved.destroyedPower).toBe(0);
  });
});

describe("Venom Eyes drain", () => {
  it("drains every other card by totalDrain at the start of a turn, floored at 0, and never itself", () => {
    const state = emptyGame("bottom");
    setLane(state, 0, [
      instance(def("V", 5, 8, venom()), "bottom"),
      instance(def("ALLY", 1, 3), "bottom"),
      instance(def("FOE", 1, 1), "top"),
    ]);
    // endTurn (bottom -> top) runs top's startTurn, which applies the drain.
    const after = endTurn(state, mulberry32(0)).state;
    const v = after.lanes[0].find((c) => c?.def.id === "V")!;
    const ally = after.lanes[0].find((c) => c?.def.id === "ALLY")!;
    const foe = after.lanes[0].find((c) => c?.def.id === "FOE")!;
    expect(v.bonus).toBe(0); // Venom exempt
    expect(ally.bonus).toBe(-1);
    expect(foe.bonus).toBe(-1);
    expect(effectivePower(after, 0, foe)).toBe(0); // 1 - 1 floored
  });

  it("is seat-agnostic: fires on both seats start turns", () => {
    const state = emptyGame("bottom");
    setLane(state, 0, [
      null,
      instance(def("V", 5, 8, venom()), "bottom"),
      instance(def("ALLY", 1, 5), "bottom"),
    ]);
    // Two startTurns happen: top's (after bottom ends) and bottom's (after round resolves).
    const r1 = endTurn(state, mulberry32(0)).state; // top startTurn: -1
    const r2 = endTurn(r1, mulberry32(0)).state; // resolves round, bottom startTurn: -1 more
    const ally = r2.lanes[0].find((c) => c?.def.id === "ALLY")!;
    expect(ally.bonus).toBe(-2);
  });

  it("two Venoms stack to -2 and neither reduces the other or itself", () => {
    const state = emptyGame("bottom");
    setLane(state, 0, [
      instance(def("V1", 5, 8, venom()), "bottom"),
      instance(def("V2", 5, 8, venom()), "top"),
      instance(def("OTHER", 1, 9), "bottom"),
    ]);
    const after = endTurn(state, mulberry32(0)).state; // top startTurn
    const v1 = after.lanes[0].find((c) => c?.def.id === "V1")!;
    const v2 = after.lanes[0].find((c) => c?.def.id === "V2")!;
    const other = after.lanes[0].find((c) => c?.def.id === "OTHER")!;
    expect(v1.bonus).toBe(0);
    expect(v2.bonus).toBe(0);
    expect(other.bonus).toBe(-2);
  });

  it("newGame first startTurn is a no-op on an empty board (no event, no mutation)", () => {
    const state = emptyGame("bottom");
    const drainEvents = (ev: { type: string; text?: string }[]) =>
      ev.filter((e) => e.type === "ability" && e.text?.includes("drained"));
    // emptyGame already ran newGame's startTurn with an empty board. Ending to the next
    // startTurn with no cards still produces no drain event.
    const step = endTurn(state, mulberry32(0));
    expect(drainEvents(step.events)).toHaveLength(0);
    expect(onBoard(step.state)).toHaveLength(0);
  });
});

describe("Ocean Eyes end-of-round return", () => {
  const setupOcean = (first: "bottom" | "top" = "bottom") => {
    const state = emptyGame(first);
    state.players.bottom.deck = [def("D0", 1, 1), def("D1", 1, 1)];
    return state;
  };

  it("buffs allies +1 (excluding itself), returns to the deck, and resets bonus", () => {
    const state = setupOcean();
    setLane(state, 0, [
      null,
      instance(def("OCE", 1, 2, ocean()), "bottom"),
      instance(def("ALLY", 1, 3), "bottom"),
    ]);
    setLane(state, 1, [null, null, instance(def("FAR", 1, 1), "bottom")]); // another lane ally
    const after = endTurn(
      endTurn(state, mulberry32(0)).state,
      mulberry32(0),
    ).state;
    // Ocean is gone from the board.
    expect(onBoard(after).some((c) => c.def.id === "OCE")).toBe(false);
    // Its def is back in the owner's library (deck, or hand if the next startTurn drew it).
    const library = [
      ...after.players.bottom.deck.map((d) => d.id),
      ...after.players.bottom.hand.map((c) => c.def.id),
    ];
    expect(library).toContain("OCE");
    // Allies across all lanes got +1.
    const ally = onBoard(after).find((c) => c.def.id === "ALLY");
    const far = onBoard(after).find((c) => c.def.id === "FAR");
    expect(ally!.bonus).toBe(1);
    expect(far!.bonus).toBe(1);
  });

  it("inserts at a deterministic seeded position", () => {
    const build = () => {
      const s = setupOcean();
      setLane(s, 0, [
        null,
        null,
        instance(def("OCE", 1, 2, ocean()), "bottom"),
      ]);
      return s;
    };
    // Resolve on the top player's endTurn (first = top), so bottom does not immediately draw
    // the returned Ocean and we can read its exact deck slot.
    const resolve = (seed: number) => {
      const s = build();
      s.first = "top";
      s.active = "top";
      return endTurn(s, mulberry32(seed)).state.players.bottom.deck.map(
        (d) => d.id,
      );
    };
    // Same seed -> identical deck ordering (including Ocean's inserted slot).
    expect(resolve(42)).toEqual(resolve(42));
    const seedA = endTurn(
      endTurn(build(), mulberry32(0)).state,
      mulberry32(42),
    ).state;
    const seedA2 = endTurn(
      endTurn(build(), mulberry32(0)).state,
      mulberry32(42),
    ).state;
    // Same seed -> same insertion index.
    expect(seedA.players.bottom.deck.findIndex((d) => d.id === "OCE")).toBe(
      seedA2.players.bottom.deck.findIndex((d) => d.id === "OCE"),
    );
  });

  it("handles the empty-deck case (Ocean becomes the only library card, then is drawn next turn)", () => {
    const state = emptyGame("bottom");
    state.players.bottom.deck = [];
    setLane(state, 0, [
      null,
      null,
      instance(def("OCE", 1, 2, ocean()), "bottom"),
    ]);
    const after = endTurn(
      endTurn(state, mulberry32(0)).state,
      mulberry32(0),
    ).state;
    // Ocean returned to the empty deck at index 0, so the next round's startTurn draws it to hand.
    const library = [
      ...after.players.bottom.deck.map((d) => d.id),
      ...after.players.bottom.hand.map((c) => c.def.id),
    ];
    expect(library).toEqual(["OCE"]);
    // It returned clean: a freshly drawn instance has no bonus.
    const drawn = after.players.bottom.hand.find((c) => c.def.id === "OCE");
    if (drawn) expect(drawn.bonus).toBe(0);
  });

  it("two Oceans produce an order-independent final state; Ocean-on-Ocean buff is discarded", () => {
    const build = () => {
      const s = emptyGame("bottom");
      s.players.bottom.deck = [
        def("D0", 1, 1),
        def("D1", 1, 1),
        def("D2", 1, 1),
      ];
      setLane(s, 0, [
        null,
        instance(def("O1", 1, 2, ocean()), "bottom"),
        instance(def("O2", 1, 2, ocean()), "bottom"),
      ]);
      return s;
    };
    const after = endTurn(
      endTurn(build(), mulberry32(0)).state,
      mulberry32(7),
    ).state;
    // Both Oceans left the board and are back in the owner's library (deck + hand), returned clean.
    expect(
      onBoard(after).some((c) => c.def.id === "O1" || c.def.id === "O2"),
    ).toBe(false);
    const library = [
      ...after.players.bottom.deck.map((d) => d.id),
      ...after.players.bottom.hand.map((c) => c.def.id),
    ];
    expect(library.filter((id) => id === "O1" || id === "O2")).toHaveLength(2);
    for (const c of after.players.bottom.hand)
      if (c.def.id === "O1" || c.def.id === "O2") expect(c.bonus).toBe(0);
  });
});

describe("Siren Eyes push lane", () => {
  it("shoves the lane far-edge-first and destroys the far card into the tally", () => {
    const state = emptyGame("bottom");
    // bottom's far edge is cell 0. Full lane: enemy at the far edge gets shoved off.
    setLane(state, 0, [
      instance(def("FAR", 1, 3), "top"),
      instance(def("MID", 1, 1), "top"),
      null, // Siren will enter at cell 2 (bottom near edge)
    ]);
    const after = play(state, "bottom", def("SIREN", 4, 2, siren()), 0);
    // Siren entered at cell 2, then the lane shoved one step toward cell 0: FAR off the edge.
    expect(after.destroyedPower).toBe(3);
    expect(onBoard(after).some((c) => c.def.id === "FAR")).toBe(false);
  });

  it("an enemy Phoenix shoved off by Siren returns to the enemy hand", () => {
    const state = emptyGame("bottom");
    setLane(state, 0, [
      instance(def("PHX", 4, 4, phoenix()), "top"),
      instance(def("MID", 1, 1), "top"),
      null,
    ]);
    const after = play(state, "bottom", def("SIREN", 4, 2, siren()), 0);
    expect(after.destroyedPower).toBe(0);
    expect(after.players.top.hand.some((c) => c.def.id === "PHX")).toBe(true);
  });

  it("does not destroy a pushImmune enemy card at the far edge, but does not block the lane", () => {
    const state = emptyGame("bottom");
    const immuneFoe = instance(def("BED", 3, 5, bedrock()), "top");
    // bottom far edge is cell 0. Put the immune foe at the far edge so the shove hits it first,
    // with an own card behind it at cell 1.
    setLane(state, 0, [immuneFoe, instance(def("MINE", 1, 1), "bottom"), null]);
    const after = play(state, "bottom", def("SIREN", 4, 2, siren()), 0);
    // The immune card survives at its far-edge cell; nothing is destroyed.
    expect(after.destroyedPower).toBe(0);
    expect(onBoard(after).some((c) => c.def.id === "BED")).toBe(true);
    expect(after.lanes[0][0]?.def.id).toBe("BED"); // stays at the far edge (acts as a wall)
    // The card behind it cannot advance into the wall cell: it stays put at cell 1.
    expect(after.lanes[0][1]?.def.id).toBe("MINE");
  });

  it("ignores anchor and shoves an anchored lane", () => {
    const state = emptyGame("bottom");
    const anchorCard = def("ANCHOR", 1, 1, {
      timing: "continuous",
      effect: { kind: "anchor" },
    });
    setLane(state, 0, [
      instance(def("FAR", 1, 2), "top"),
      instance(anchorCard, "top"),
      null,
    ]);
    const after = play(state, "bottom", def("SIREN", 4, 2, siren()), 0);
    // Anchor does not stop Siren's resolved shove: FAR is pushed off.
    expect(after.destroyedPower).toBe(2);
  });
});

describe("Laser Eyes destroy lane", () => {
  it("destroys every other card except itself and tallies their power", () => {
    const state = emptyGame("bottom");
    setLane(state, 0, [
      instance(def("E1", 1, 3), "top"),
      instance(def("F1", 1, 2), "bottom"),
      null,
    ]);
    const after = play(state, "bottom", def("LASER", 4, 4, laser()), 0);
    const survivors = onBoard(after).map((c) => c.def.id);
    expect(survivors).toContain("LASER");
    expect(survivors).not.toContain("E1");
    expect(survivors).not.toContain("F1");
    expect(after.destroyedPower).toBe(5); // 3 + 2
  });

  it("triggers an enemy Phoenix revive into the ENEMY hand", () => {
    const state = emptyGame("bottom");
    const enemyPhoenix = instance(def("PHX", 4, 4, phoenix()), "top");
    setLane(state, 0, [enemyPhoenix, null, null]);
    const after = play(state, "bottom", def("LASER", 4, 4, laser()), 0);
    // Laser destroys the Phoenix, reviving it to the enemy hand (not tallied).
    expect(onBoard(after).some((c) => c.def.id === "PHX")).toBe(false);
    expect(
      after.players.top.hand.some((c) => c.def.id === "PHX" && c.bonus === 4),
    ).toBe(true);
    expect(after.destroyedPower).toBe(0);
  });

  it("destroys a pushImmune card (immunity is to being pushed off, not destruction)", () => {
    const state = emptyGame("bottom");
    setLane(state, 0, [
      instance(def("BED", 3, 5, bedrock()), "top"),
      null,
      null,
    ]);
    const after = play(state, "bottom", def("LASER", 4, 4, laser()), 0);
    // Push immunity does not protect against Laser's destroy: BED is gone and tallied.
    expect(onBoard(after).some((c) => c.def.id === "BED")).toBe(false);
    expect(after.destroyedPower).toBe(5);
  });

  it("emits a single summary event and an empty-lane guard when alone", () => {
    const state = emptyGame("bottom");
    const laserCard = def("LASER", 4, 4, laser());
    const c = give(state, "bottom", laserCard);
    state.players.bottom.energy = 4;
    const { events } = playCard(state, c.uid, 0);
    const summaries = events.filter(
      (e) => e.type === "ability" && e.card.id === "LASER",
    );
    expect(summaries).toHaveLength(1);
    expect((summaries[0] as { text: string }).text).toBe(
      "found no other cards to destroy",
    );
  });
});

describe("purity", () => {
  it("playCard and endTurn do not mutate their input", () => {
    const state = emptyGame("bottom");
    setLane(state, 0, [
      instance(def("V", 5, 8, venom()), "bottom"),
      instance(def("ALLY", 1, 3), "bottom"),
      null,
    ]);
    const snapshot = structuredClone(state);
    endTurn(state, mulberry32(0));
    expect(state).toEqual(snapshot);

    const pstate = emptyGame("bottom");
    const x = give(pstate, "bottom", def("X", 1, 1));
    pstate.players.bottom.energy = 1;
    const psnap = structuredClone(pstate);
    playCard(pstate, x.uid, 0);
    expect(pstate).toEqual(psnap);
  });
});

import { describe, expect, it } from "vitest";
import { abilityText } from "../src/engine/abilities";
import { describeEvent } from "../src/engine/events";
import { endTurn, playCard } from "../src/engine/rules";
import type {
  Ability,
  CardInstance,
  GameEvent,
  GameState,
  LaneIndex,
} from "../src/engine/types";
import { mulberry32 } from "../src/util/rng";
import { parseAbility } from "../src/data/ability-parse";
import { def, emptyGame, give, instance, setLane } from "./engine-helpers";

// Ability constructors for the seven clone-batch cards (mirror their shorthand in cards.json).
const spectra = (): Ability => ({
  timing: "active",
  effect: { kind: "cloneBoard" },
});
const echo = (): Ability => ({
  timing: "active",
  effect: { kind: "cloneLane" },
});
const dual = (): Ability => ({
  timing: "active",
  effect: { kind: "cloneMirror" },
});
const nexus = (): Ability => ({
  timing: "active",
  effect: { kind: "nexusSum" },
});
const glacial = (drop = 2): Ability => ({
  timing: "onDestroy",
  effect: { kind: "glacialSpawn", drop },
});
const dorans = (amount = 4, byTurn = 6): Ability => ({
  timing: "onPlay",
  effect: { kind: "earlyBuff", amount, byTurn },
});
const cosmic = (amount = 1): Ability => ({
  timing: "endOfRound",
  effect: { kind: "teamBuffEndOfTurn", amount },
});

const onBoard = (state: GameState): CardInstance[] =>
  state.lanes.flat().filter((c): c is CardInstance => c !== null);
const power = (c: CardInstance) => c.def.power + c.bonus;

/** Plays a card from `seat`'s hand into `lane`, paying its cost (optionally with an explicit rng). */
function play(
  state: GameState,
  seat: "bottom" | "top",
  card: ReturnType<typeof def>,
  lane: LaneIndex,
  rng = mulberry32(123),
): { state: GameState; events: GameEvent[] } {
  const c = give(state, seat, card);
  state.players[seat].energy = Math.max(state.players[seat].energy, card.cost);
  return playCard(state, c.uid, lane, rng);
}

// --- 8.1 clone primitive (via Spectra) + nearestEmptyCell (via Dual/Glacial) ---

describe("clone primitive (observed through Spectra)", () => {
  it("1. a clone carries the source's CURRENT power (base + bonus)", () => {
    const state = emptyGame();
    // Spectra base power 3; give it +4 bonus on the board → current 7.
    const src = give(state, "bottom", def("SPEC", 3, 3, spectra()));
    src.bonus = 4; // current power 7
    state.players.bottom.energy = 3;
    const after = playCard(state, src.uid, 0, mulberry32(1)).state;
    const copies = onBoard(after).filter((c) => c.def.id === "SPEC");
    // The played Spectra plus 8 clones = 9; every one carries current power 7.
    expect(copies.length).toBe(9);
    for (const c of copies) expect(power(c)).toBe(7);
    // Clones (not the played card) carry the source's bonus (4) at clone time.
    const clones = copies.filter((c) => c.uid !== src.uid);
    expect(clones.length).toBe(8);
    for (const c of clones) expect(c.bonus).toBe(4);
  });

  it("2. clones get fresh distinct uids, same owner, shared def reference", () => {
    const state = emptyGame();
    const after = play(state, "bottom", def("SPEC", 3, 3, spectra()), 0).state;
    const copies = onBoard(after).filter((c) => c.def.id === "SPEC");
    const uids = new Set(copies.map((c) => c.uid));
    expect(uids.size).toBe(copies.length); // all distinct
    // Every SPEC instance (played card + clones) shares one def reference.
    const srcDef = copies[0].def;
    for (const c of copies) {
      expect(c.owner).toBe("bottom");
      expect(c.def).toBe(srcDef); // same def reference across all copies
    }
  });

  it("3. each spawn emits one cloned event with the right shape", () => {
    const state = emptyGame();
    const after = play(state, "bottom", def("SPEC", 3, 3, spectra()), 0);
    const cloned = after.events.filter((e) => e.type === "cloned");
    expect(cloned.length).toBe(8); // 9 cells minus Spectra's own
    for (const e of cloned) {
      if (e.type !== "cloned") continue;
      expect(e.seat).toBe("bottom");
      expect(e.card.id).toBe("SPEC");
      expect(e.uid).toBeGreaterThan(0);
      expect(after.state.lanes[e.lane][e.cell]?.uid).toBe(e.uid);
    }
  });

  it("4. nearestEmptyCell scans toward the owner's edge (bottom 2→0, top 0→2)", () => {
    // Dual bottom-owner: lane 0 has only cell 0 free, mirror target lane 2 has cells 1 and 2 free.
    const state = emptyGame();
    setLane(state, 0, [
      null,
      instance(def("A", 1, 1), "bottom"),
      instance(def("B", 1, 1), "bottom"),
    ]);
    // Dual enters lane 0 at cell 0 (only free cell there). Lane 2 free at cells 1,2 → nearest bottom = 2.
    const after = play(state, "bottom", def("DUAL", 4, 6, dual()), 0).state;
    expect(after.lanes[2][2]?.def.id).toBe("DUAL"); // bottom edge first
    expect(after.lanes[2][1]).toBeNull();
  });
});

// --- 8.2 Spectra (cloneBoard) ---

describe("Spectra Eyes (cloneBoard)", () => {
  it("5. fills every other empty cell on an empty board (8 copies)", () => {
    const state = emptyGame();
    const after = play(state, "bottom", def("SPEC", 3, 5, spectra()), 1);
    expect(onBoard(after.state).filter((c) => c.def.id === "SPEC").length).toBe(
      9,
    );
    const summary = after.events.find(
      (e) => e.type === "ability" && e.text === "spawned 8 copies",
    );
    expect(summary).toBeDefined();
  });

  it("6. only empty cells get clones; occupied cells untouched", () => {
    const state = emptyGame();
    const keep = instance(def("KEEP", 1, 2), "top");
    setLane(state, 2, [keep, null, null]);
    const after = play(state, "bottom", def("SPEC", 3, 5, spectra()), 0).state;
    expect(after.lanes[2][0]?.uid).toBe(keep.uid); // not overwritten
    expect(after.lanes[2][0]?.def.id).toBe("KEEP");
    // 9 cells, 1 occupied by KEEP, 1 by Spectra → 7 clones.
    expect(onBoard(after).filter((c) => c.def.id === "SPEC").length).toBe(8);
  });

  it("7. clones do not re-fire active (no cascade of extra cloned events)", () => {
    const state = emptyGame();
    const after = play(state, "bottom", def("SPEC", 3, 5, spectra()), 0);
    const cloned = after.events.filter((e) => e.type === "cloned");
    expect(cloned.length).toBe(8); // exactly one wave, no recursion
  });
});

// --- 8.3 Echo (cloneLane) ---

describe("Echo Eyes (cloneLane)", () => {
  it("8. clones only into empty cells of the played lane", () => {
    const state = emptyGame();
    const after = play(state, "bottom", def("ECHO", 3, 3, echo()), 1).state;
    // Lane 1: Echo + 2 clones = 3 ECHO. Lanes 0 and 2 untouched.
    expect(after.lanes[1].filter((c) => c?.def.id === "ECHO").length).toBe(3);
    expect(onBoard(after).filter((c) => c.def.id === "ECHO").length).toBe(3);
  });

  it("9. clones carry Echo's current power", () => {
    const state = emptyGame();
    const after = play(state, "bottom", def("ECHO", 3, 8, echo()), 0).state;
    for (const c of after.lanes[0].filter((c) => c?.def.id === "ECHO"))
      expect(power(c!)).toBe(8);
  });
});

// --- 8.4 Dual (cloneMirror) ---

describe("Dual Eyes (cloneMirror)", () => {
  it("10. side lane → clone in opposite side lane at owner's entry cell", () => {
    const state = emptyGame();
    const after = play(state, "bottom", def("DUAL", 4, 6, dual()), 0).state;
    // bottom entry cell is 2; lane 2 is empty → clone lands at cell 2.
    expect(after.lanes[2][2]?.def.id).toBe("DUAL");
    expect(power(after.lanes[2][2]!)).toBe(6);
  });

  it("11. entry cell occupied → nearest empty cell toward owner", () => {
    const state = emptyGame();
    setLane(state, 2, [null, null, instance(def("X", 1, 1), "bottom")]);
    const after = play(state, "bottom", def("DUAL", 4, 6, dual()), 0).state;
    expect(after.lanes[2][1]?.def.id).toBe("DUAL"); // cell 2 taken → cell 1
  });

  it("12. target lane full → no clone, found-no-room event", () => {
    const state = emptyGame();
    setLane(state, 2, [
      instance(def("A", 1, 1), "bottom"),
      instance(def("B", 1, 1), "bottom"),
      instance(def("C", 1, 1), "bottom"),
    ]);
    const after = play(state, "bottom", def("DUAL", 4, 6, dual()), 0);
    expect(onBoard(after.state).filter((c) => c.def.id === "DUAL").length).toBe(
      1,
    );
    expect(
      after.events.some(
        (e) => e.type === "ability" && e.text === "found no room to mirror",
      ),
    ).toBe(true);
  });

  it("13. middle lane → nothing, found-no-side-lane event", () => {
    const state = emptyGame();
    const after = play(state, "bottom", def("DUAL", 4, 6, dual()), 1);
    expect(onBoard(after.state).filter((c) => c.def.id === "DUAL").length).toBe(
      1,
    );
    expect(
      after.events.some(
        (e) =>
          e.type === "ability" && e.text === "found no side lane to mirror",
      ),
    ).toBe(true);
  });
});

// --- 8.5 Glacial (glacialSpawn) ---

/**
 * Forces `glacialInst` (top-owned) off the top edge of `lane` via a bottom entry push.
 * The lane is FULL top→bottom: [glacial, filler, filler]; bottom enters at cell 2 and the
 * lane shoves toward cell 0, carrying the far card (Glacial) off the top edge.
 */
function pushTopGlacialOff(
  state: GameState,
  glacialInst: CardInstance,
  lane: LaneIndex = 0,
): { state: GameState; events: GameEvent[] } {
  setLane(state, lane, [
    glacialInst,
    instance(def("MID", 1, 1), "top"),
    instance(def("NEAR", 1, 1), "top"),
  ]);
  return play(state, "bottom", def("PUSH", 1, 1), lane);
}

describe("Glacial Eyes (glacialSpawn)", () => {
  it("14. pushed off at power 5 → power-3 clones in each of the 2 other lanes; power tallied", () => {
    const state = emptyGame();
    const g = instance(def("GLAC", 4, 5, glacial(2)), "top");
    const after = pushTopGlacialOff(state, g, 0);
    const clones = onBoard(after.state).filter((c) => c.def.id === "GLAC");
    // Original gone; two spawns in lanes 1 and 2 at power 3.
    expect(clones.length).toBe(2);
    const lanes = clones
      .map((c) =>
        after.state.lanes.findIndex((l) => l.some((x) => x?.uid === c.uid)),
      )
      .sort();
    expect(lanes).toEqual([1, 2]);
    for (const c of clones) expect(power(c)).toBe(3);
    // top owner → nearest cell is 0 (top edge).
    expect(after.state.lanes[1][0]?.def.id).toBe("GLAC");
    expect(after.state.lanes[2][0]?.def.id).toBe("GLAC");
    expect(after.state.destroyedPower).toBeGreaterThanOrEqual(5);
  });

  it("15. chain terminates: 5 → 3 → 1 → stop; no clone of power ≤ 0", () => {
    // A power-3 Glacial pushed off spawns power-1 clones; a power-1 pushed off spawns nothing.
    const state = emptyGame();
    const g3 = instance(def("GLAC", 4, 3, glacial(2)), "top");
    const after3 = pushTopGlacialOff(state, g3, 0);
    const spawned3 = onBoard(after3.state).filter((c) => c.def.id === "GLAC");
    expect(spawned3.length).toBe(2);
    for (const c of spawned3) expect(power(c)).toBe(1);

    // Now push a power-1 Glacial off: 1 - 2 = -1 ≤ 0 → no spawn.
    const state2 = emptyGame();
    const g1 = instance(def("GLAC", 4, 1, glacial(2)), "top");
    const after1 = pushTopGlacialOff(state2, g1, 0);
    expect(
      onBoard(after1.state).filter((c) => c.def.id === "GLAC").length,
    ).toBe(0);
  });

  it("16. a full lane is skipped (only the open lane gets a clone)", () => {
    const state = emptyGame();
    // Fill lane 1 so only lane 2 can take a spawn.
    setLane(state, 1, [
      instance(def("F0", 1, 1), "top"),
      instance(def("F1", 1, 1), "top"),
      instance(def("F2", 1, 1), "top"),
    ]);
    const g = instance(def("GLAC", 4, 5, glacial(2)), "top");
    const after = pushTopGlacialOff(state, g, 0);
    const clones = onBoard(after.state).filter((c) => c.def.id === "GLAC");
    expect(clones.length).toBe(1); // lane 1 full → skipped
    expect(after.state.lanes[2][0]?.def.id).toBe("GLAC");
  });

  it("17. destroyed by Laser (direct destroy) → no spawn, still tallied", () => {
    const state = emptyGame();
    const laser = (): Ability => ({
      timing: "active",
      effect: { kind: "destroyLane" },
    });
    const g = instance(def("GLAC", 4, 5, glacial(2)), "top");
    // Laser (bottom) enters lane 0 and destroys every other card in that lane.
    setLane(state, 0, [g, null, null]);
    const after = play(state, "bottom", def("LAS", 4, 2, laser()), 0);
    expect(onBoard(after.state).filter((c) => c.def.id === "GLAC").length).toBe(
      0,
    );
    expect(after.state.destroyedPower).toBeGreaterThanOrEqual(5);
  });

  it("18. shoved off by Siren → spawns like a push", () => {
    const state = emptyGame();
    const siren = (): Ability => ({
      timing: "active",
      effect: { kind: "pushLane" },
    });
    const g = instance(def("GLAC", 4, 5, glacial(2)), "top");
    // Siren (bottom) enters lane 0 at cell 2; the lane shoves toward cell 0, carrying GLAC off.
    setLane(state, 0, [g, instance(def("MID", 1, 1), "top"), null]);
    const after = play(state, "bottom", def("SIR", 4, 2, siren()), 0);
    const clones = onBoard(after.state).filter((c) => c.def.id === "GLAC");
    expect(clones.length).toBe(2);
    for (const c of clones) expect(power(c)).toBe(3);
  });

  it("19. a push destroying Glacial with Phasing/Bedrock on the board does not throw", () => {
    const state = emptyGame();
    const bedrock = (): Ability => ({
      timing: "continuous",
      effect: { kind: "pushImmune" },
    });
    const g = instance(def("GLAC", 4, 5, glacial(2)), "top");
    setLane(state, 0, [g, instance(def("MID", 1, 1), "top"), null]);
    setLane(state, 1, [
      instance(def("BED", 3, 5, bedrock()), "top"),
      null,
      null,
    ]);
    expect(() => play(state, "bottom", def("PUSH", 1, 1), 0)).not.toThrow();
  });
});

// --- 8.6 Doran's (earlyBuff) ---

describe("Doran's Eyes (earlyBuff)", () => {
  it("20. played on turn ≤ 6 → +4 power and an ability event", () => {
    const state = emptyGame();
    state.turnsPlayed = 0; // turn = min(0+1, 18) = 1
    const after = play(state, "bottom", def("DOR", 1, 2, dorans(4, 6)), 0);
    const dor = onBoard(after.state).find((c) => c.def.id === "DOR")!;
    expect(power(dor)).toBe(6); // 2 + 4
    expect(
      after.events.some(
        (e) =>
          e.type === "ability" &&
          e.text === "gained +4 power for an early play",
      ),
    ).toBe(true);
  });

  it("21. played on turn 7+ → no bonus, no ability event", () => {
    const state = emptyGame();
    state.turnsPlayed = 7; // turn = min(7+1, 18) = 8
    const after = play(state, "bottom", def("DOR", 1, 2, dorans(4, 6)), 0);
    const dor = onBoard(after.state).find((c) => c.def.id === "DOR")!;
    expect(power(dor)).toBe(2);
    expect(
      after.events.some(
        (e) => e.type === "ability" && e.text.includes("early play"),
      ),
    ).toBe(false);
  });

  it("22. boundary: turn 6 buffs, turn 7 does not", () => {
    const s6 = emptyGame();
    s6.turnsPlayed = 5; // turn = 6
    const a6 = play(s6, "bottom", def("DOR", 1, 2, dorans(4, 6)), 0);
    expect(power(onBoard(a6.state).find((c) => c.def.id === "DOR")!)).toBe(6);

    const s7 = emptyGame();
    s7.turnsPlayed = 6; // turn = 7
    const a7 = play(s7, "bottom", def("DOR", 1, 2, dorans(4, 6)), 0);
    expect(power(onBoard(a7.state).find((c) => c.def.id === "DOR")!)).toBe(2);
  });
});

// --- 8.7 Nexus (nexusSum) ---

describe("Nexus Eyes (nexusSum)", () => {
  it("23. middle lane → +sum of same-row side-lane neighbors' current power", () => {
    const state = emptyGame();
    // bottom entry cell for lane 1 is cell 2; put neighbors at cell 2 of lanes 0 and 2.
    setLane(state, 0, [null, null, instance(def("L", 1, 3), "top")]);
    setLane(state, 2, [null, null, instance(def("R", 1, 5), "bottom")]);
    const after = play(state, "bottom", def("NEX", 4, 4, nexus()), 1).state;
    const nex = onBoard(after).find((c) => c.def.id === "NEX")!;
    expect(power(nex)).toBe(4 + 8); // 3 + 5 = 8
  });

  it("24. empty neighbors count as 0", () => {
    const state = emptyGame();
    const after = play(state, "bottom", def("NEX", 4, 4, nexus()), 1).state;
    expect(power(onBoard(after).find((c) => c.def.id === "NEX")!)).toBe(4);
  });

  it("25. side lane → no gain, found-no-neighbors event", () => {
    const state = emptyGame();
    const after = play(state, "bottom", def("NEX", 4, 4, nexus()), 0);
    expect(power(onBoard(after.state).find((c) => c.def.id === "NEX")!)).toBe(
      4,
    );
    expect(
      after.events.some(
        (e) =>
          e.type === "ability" && e.text === "found no neighbors to draw from",
      ),
    ).toBe(true);
  });

  it("26. reads CURRENT (bonus-inclusive) neighbor power", () => {
    const state = emptyGame();
    setLane(state, 0, [null, null, instance(def("L", 1, 1), "top", 4)]); // current 5
    setLane(state, 2, [null, null, instance(def("R", 1, 2), "bottom", 1)]); // current 3
    const after = play(state, "bottom", def("NEX", 4, 4, nexus()), 1).state;
    expect(power(onBoard(after).find((c) => c.def.id === "NEX")!)).toBe(4 + 8);
  });
});

// --- 8.8 Cosmic (teamBuffEndOfTurn) ---

describe("Cosmic Eyes (teamBuffEndOfTurn)", () => {
  it("27. end of turn → owner's OTHER cards +1; enemy and Cosmic itself +0", () => {
    const state = emptyGame();
    const cos = instance(def("COS", 6, 8, cosmic(1)), "bottom");
    const ally1 = instance(def("A1", 1, 1), "bottom");
    const ally2 = instance(def("A2", 1, 2), "bottom");
    const foe = instance(def("F", 1, 3), "top");
    setLane(state, 0, [foe, ally1, cos]);
    setLane(state, 1, [null, null, ally2]);
    state.active = "bottom";
    const after = endTurn(state, mulberry32(1)).state;
    const find = (id: string) => onBoard(after).find((c) => c.def.id === id)!;
    expect(power(find("A1"))).toBe(2); // 1 + 1
    expect(power(find("A2"))).toBe(3); // 2 + 1
    expect(power(find("COS"))).toBe(8); // itself unchanged
    expect(power(find("F"))).toBe(3); // enemy unchanged
  });

  it("28. the buff lands BEFORE the tide read (rawDelta reflects +1)", () => {
    const state = emptyGame();
    const cos = instance(def("COS", 6, 8, cosmic(1)), "bottom");
    const ally = instance(def("A", 1, 2), "bottom");
    setLane(state, 0, [null, ally, cos]);
    state.active = "bottom";
    // bottom board = Cosmic 8 + ally (2 → 3 after buff) = 11; top = 0. k = 1 → rawDelta 11.
    const after = endTurn(state, mulberry32(1));
    const tide = after.events.find((e) => e.type === "tide_shifted");
    expect(tide && tide.type === "tide_shifted" && tide.rawDelta).toBe(11);
  });

  it("29. fires every turn, including the enemy's turn-end", () => {
    const state = emptyGame();
    const cos = instance(def("COS", 6, 8, cosmic(1)), "bottom");
    const ally = instance(def("A", 1, 1), "bottom");
    setLane(state, 0, [null, ally, cos]);
    // End the ENEMY's (top) turn: the bottom owner's ally still gains +1.
    state.active = "top";
    const afterEnemy = endTurn(state, mulberry32(1)).state;
    expect(power(onBoard(afterEnemy).find((c) => c.def.id === "A")!)).toBe(2);
    // End bottom's turn too: cumulative +1 more.
    afterEnemy.active = "bottom";
    const afterOwn = endTurn(afterEnemy, mulberry32(1)).state;
    expect(power(onBoard(afterOwn).find((c) => c.def.id === "A")!)).toBe(3);
  });

  it("30. two Cosmics stack (each buffs the owner's other cards)", () => {
    const state = emptyGame();
    const c1 = instance(def("COS", 6, 8, cosmic(1)), "bottom");
    const c2 = instance(def("COS", 6, 8, cosmic(1)), "bottom");
    const ally = instance(def("A", 1, 1), "bottom");
    setLane(state, 0, [null, c1, c2]);
    setLane(state, 1, [null, null, ally]);
    state.active = "bottom";
    const after = endTurn(state, mulberry32(1)).state;
    // ally buffed by both Cosmics → +2.
    expect(power(onBoard(after).find((c) => c.def.id === "A")!)).toBe(3);
    // each Cosmic buffs the OTHER Cosmic (not itself) → each +1.
    for (const c of onBoard(after).filter((c) => c.def.id === "COS"))
      expect(power(c)).toBe(9);
  });
});

// --- 8.9 text / data / exhaustiveness ---

describe("ability text and parsing", () => {
  it("31. abilityText renders the exact strings for all seven", () => {
    expect(abilityText(spectra())).toBe(
      "Active: Place a copy of this card into every empty cell on the board.",
    );
    expect(abilityText(echo())).toBe(
      "Active: Place a copy of this card into every empty cell in this lane.",
    );
    expect(abilityText(dual())).toBe(
      "Active: If played in a side lane, place a copy of this card in the other side lane.",
    );
    expect(abilityText(nexus())).toBe(
      "Active: If played in the middle lane, gain power equal to the two cards beside it in the same row.",
    );
    expect(abilityText(glacial(2))).toBe(
      "Passive: When pushed off the board, spawn a copy with 2 less power into each of the other two lanes.",
    );
    expect(abilityText(dorans(4, 6))).toBe(
      "Passive: If played by turn 6, gain +4 power.",
    );
    expect(abilityText(cosmic(1))).toBe(
      "Passive: At the end of every turn, give your other cards +1 power.",
    );
  });

  it("32. parseAbility parses each shorthand; earlyBuff arg validation holds", () => {
    expect(parseAbility("cloneBoard", "Spectra Eyes")).toEqual(spectra());
    expect(parseAbility("cloneLane", "Echo Eyes")).toEqual(echo());
    expect(parseAbility("cloneMirror", "Dual Eyes")).toEqual(dual());
    expect(parseAbility("nexusSum", "Nexus Eyes")).toEqual(nexus());
    expect(parseAbility("glacialSpawn 2", "Glacial Eyes")).toEqual(glacial(2));
    expect(parseAbility("earlyBuff 4 6", "Doran's Eyes")).toEqual(dorans(4, 6));
    expect(parseAbility("teamBuffEndOfTurn 1", "Cosmic Eyes")).toEqual(
      cosmic(1),
    );
    // earlyBuff wrong arity / non-integer args throw.
    expect(() => parseAbility("earlyBuff 4", "Doran's Eyes")).toThrow(
      /requires 2 arguments/,
    );
    expect(() => parseAbility("earlyBuff x 6", "Doran's Eyes")).toThrow(
      /needs an integer amount/,
    );
    expect(() => parseAbility("earlyBuff 4 y", "Doran's Eyes")).toThrow(
      /needs an integer byTurn/,
    );
    // transformAt regression: original positive-integer-count and non-empty-id errors unchanged,
    // and a valid transformAt still parses to the same shape.
    expect(() => parseAbility("transformAt 0 foo", "Bò SPD")).toThrow(
      /positive integer count/,
    );
    expect(() => parseAbility("transformAt 2", "Bò SPD")).toThrow(
      /requires 2 arguments/,
    );
    expect(parseAbility("transformAt 2 foo", "Bò SPD")).toEqual({
      timing: "continuous",
      effect: { kind: "transformAt", count: 2, into: "foo" },
    });
  });
});

describe("describeEvent for cloned", () => {
  it("34. renders a cloned event sentence for the viewer", () => {
    const state = emptyGame();
    const after = play(state, "bottom", def("SPEC", 3, 3, spectra()), 0);
    const cloned = after.events.find((e) => e.type === "cloned")!;
    const line = describeEvent(cloned, "bottom");
    expect(line).toMatch(
      /^You SPEC spawned a copy in the (Left|Middle|Right) lane\.$/,
    );
  });
});

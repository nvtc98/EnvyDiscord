import { describe, expect, it } from "vitest";
import { CARDS } from "../src/data/cards";
import {
  chooseTurn,
  evaluate,
  playAiTurn,
  type Difficulty,
} from "../src/engine/ai";
import { describeEvent } from "../src/engine/events";
import { pushInto, wouldPush } from "../src/engine/push";
import {
  canPlay,
  effectivePower,
  endTurn,
  forfeit,
  legalPlays,
  newGame,
  playCard,
  totalPower,
} from "../src/engine/rules";
import {
  MAX_TURNS,
  MAX_HAND,
  OPENING_HAND,
  BALANCE_START,
  type CardInstance,
  type Cell,
  type GameState,
} from "../src/engine/types";
import { mulberry32 } from "../src/util/rng";
import {
  def,
  emptyGame,
  give,
  instance,
  plainDeck,
  realDeck,
  setLane,
} from "./engine-helpers";

const names = (lane: readonly Cell[]) => lane.map((c) => c?.def.id ?? "-");

describe("pushInto", () => {
  const E1 = instance(def("E1", 1, 1), "top");
  const E2 = instance(def("E2", 1, 1), "top");
  const P1 = instance(def("P1", 1, 1), "bottom");
  const P2 = instance(def("P2", 1, 1), "bottom");
  const P3 = instance(def("P3", 1, 1), "bottom");
  const X = instance(def("X", 1, 1), "bottom");
  const Y = instance(def("Y", 1, 1), "top");

  it.each([
    [
      "full lane: the far card is destroyed",
      [E1, E2, P1],
      "bottom",
      ["E2", "P1", "X"],
      "E1",
    ],
    [
      "a gap absorbs the push",
      [E1, null, P1],
      "bottom",
      ["E1", "P1", "X"],
      null,
    ],
    [
      "empty entry cell: nothing moves",
      [E1, E2, null],
      "bottom",
      ["E1", "E2", "X"],
      null,
    ],
    ["empty lane", [null, null, null], "bottom", ["-", "-", "X"], null],
    [
      "pushing into your own full lane destroys your own card",
      [P1, P2, P3],
      "bottom",
      ["P2", "P3", "X"],
      "P1",
    ],
    [
      "a gap further up still absorbs a longer chain",
      [null, P1, P2],
      "bottom",
      ["P1", "P2", "X"],
      null,
    ],
  ] as const)("bottom seat: %s", (_label, cells, seat, expected, destroyed) => {
    const result = pushInto(cells as unknown as Cell[], X, seat);
    expect(names(result.lane)).toEqual(expected);
    expect(result.destroyed?.def.id ?? null).toBe(destroyed);
  });

  it("top seat is the mirror image", () => {
    expect(names(pushInto([E1, E2, P1], Y, "top").lane)).toEqual([
      "Y",
      "E1",
      "E2",
    ]);
    expect(pushInto([E1, E2, P1], Y, "top").destroyed?.def.id).toBe("P1");
    expect(names(pushInto([null, E1, P1], Y, "top").lane)).toEqual([
      "Y",
      "E1",
      "P1",
    ]); // gap in the entry cell
    expect(names(pushInto([E1, null, P1], Y, "top").lane)).toEqual([
      "Y",
      "E1",
      "P1",
    ]); // gap absorbs
  });

  it("does not modify the input lane", () => {
    const lane: Cell[] = [E1, E2, P1];
    pushInto(lane, X, "bottom");
    expect(names(lane)).toEqual(["E1", "E2", "P1"]);
  });

  it("wouldPush is true only when the entry cell is taken", () => {
    expect(wouldPush([E1, null, P1], "bottom")).toBe(true);
    expect(wouldPush([E1, null, null], "bottom")).toBe(false);
    expect(wouldPush([E1, null, null], "top")).toBe(true);
  });
});

describe("setup and turn flow", () => {
  it("deals 2 cards to the first player and 3 to the second, then the first player draws and has 1 energy", () => {
    const { state } = newGame(
      { bottom: plainDeck(), top: plainDeck() },
      "bottom",
      mulberry32(3),
    );
    expect(state.players.bottom.hand).toHaveLength(3); // 2 + the turn draw
    expect(state.players.top.hand).toHaveLength(3);
    expect(state.players.bottom.energy).toBe(1);
    expect(state.active).toBe("bottom");
    expect(state.players.bottom.deck).toHaveLength(9);
    expect(state.players.top.deck).toHaveLength(9);
    expect(state.balance).toBe(BALANCE_START);
    expect(state.turnsPlayed).toBe(0);
  });

  it("the second player draws at the start of their turn, reaching 4 cards, with 1 energy", () => {
    const { state } = newGame(
      { bottom: plainDeck(), top: plainDeck() },
      "top",
      mulberry32(3),
    );
    expect(state.active).toBe("top");
    const next = endTurn(state, mulberry32(0)).state;
    expect(next.active).toBe("bottom");
    expect(next.players.bottom.hand).toHaveLength(4);
    expect(next.players.bottom.energy).toBe(1);
  });

  it("energy follows each player's own turn count, refills, and is capped at 9", () => {
    let state = emptyGame("bottom");
    const seen: number[] = [];
    for (let round = 1; round <= 12; round++) {
      seen.push(state.players.bottom.energy);
      state = endTurn(state, mulberry32(0)).state; // -> top
      expect(state.players.top.energy).toBe(Math.min(round, 9));
      state = endTurn(state, mulberry32(0)).state; // resolves, next round, bottom
      // Keep the game going past the 18-turn cap: this test only exercises the
      // energy curve (energy tracks players[seat].turns, not turnsPlayed).
      state.turnsPlayed = 0;
    }
    expect(seen.slice(0, 11)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9]);
  });

  it("unspent energy is not carried over", () => {
    let state = emptyGame("bottom");
    state = endTurn(endTurn(state, mulberry32(0)).state, mulberry32(0)).state; // round 2, bottom has 2
    expect(state.players.bottom.energy).toBe(2);
  });

  it("drawing from an empty deck does nothing", () => {
    const state = emptyGame("bottom");
    state.players.bottom.deck = [];
    state.players.top.deck = [];
    const after = endTurn(
      endTurn(state, mulberry32(0)).state,
      mulberry32(0),
    ).state;
    expect(after.players.bottom.hand).toHaveLength(0);
  });

  it("is deterministic for a given seed", () => {
    const a = newGame(
      { bottom: realDeck(), top: realDeck() },
      "bottom",
      mulberry32(9),
    ).state;
    const b = newGame(
      { bottom: realDeck(), top: realDeck() },
      "bottom",
      mulberry32(9),
    ).state;
    expect(a.players.bottom.hand.map((c) => c.def.id)).toEqual(
      b.players.bottom.hand.map((c) => c.def.id),
    );
  });
});

describe("playing cards", () => {
  it("spends energy, removes the card from hand, and puts it at the player's edge", () => {
    const state = emptyGame();
    const a = give(state, "bottom", def("A", 1, 3));
    state.players.bottom.energy = 1;
    const { state: after, events } = playCard(state, a.uid, 1);
    expect(after.players.bottom.energy).toBe(0);
    expect(after.players.bottom.hand).toHaveLength(0);
    expect(names(after.lanes[1])).toEqual(["-", "-", "A"]);
    expect(events[0]).toMatchObject({ type: "played", lane: 1 });
    expect(state.players.bottom.hand).toHaveLength(1); // input untouched
  });

  it("allows several plays in one turn while energy lasts, and refuses the one that does not fit", () => {
    let state = emptyGame();
    const [a, b, c] = [
      give(state, "bottom", def("A", 1, 1)),
      give(state, "bottom", def("B", 2, 1)),
      give(state, "bottom", def("C", 2, 1)),
    ];
    state.players.bottom.energy = 3;
    state = playCard(state, a.uid, 0).state;
    state = playCard(state, b.uid, 1).state;
    expect(state.players.bottom.energy).toBe(0);
    expect(canPlay(state, c.uid, 2)).toEqual({ ok: false, reason: "energy" });
    expect(() => playCard(state, c.uid, 2)).toThrow(/energy/);
  });

  it("rejects cards that are not in hand and plays after the game is over", () => {
    const state = emptyGame();
    expect(canPlay(state, 99999, 0)).toEqual({
      ok: false,
      reason: "not-in-hand",
    });
    const over = forfeit(state, "bottom").state;
    expect(canPlay(over, 1, 0)).toEqual({ ok: false, reason: "over" });
    expect(legalPlays(over)).toEqual([]);
  });

  it("the top player enters from the top edge and pushes down", () => {
    const state = emptyGame("top");
    const a = give(state, "top", def("A", 1, 1));
    state.players.top.energy = 1;
    expect(names(playCard(state, a.uid, 2).state.lanes[2])).toEqual([
      "A",
      "-",
      "-",
    ]);
  });

  it("pushing a full lane from the bottom destroys the top card and reports it", () => {
    const state = emptyGame();
    setLane(state, 0, [
      instance(def("E1", 1, 5), "top"),
      instance(def("E2", 1, 1), "top"),
      instance(def("P1", 1, 1), "bottom"),
    ]);
    const x = give(state, "bottom", def("X", 1, 1));
    state.players.bottom.energy = 1;
    const { state: after, events } = playCard(state, x.uid, 0);
    expect(names(after.lanes[0])).toEqual(["E2", "P1", "X"]);
    expect(events[0]).toMatchObject({
      destroyed: { card: { id: "E1" }, owner: "top" },
    });
    expect(totalPower(after, "top")).toBe(1); // E1's power is gone immediately
  });

  it("legalPlays lists every affordable card in every playable lane", () => {
    const state = emptyGame();
    give(state, "bottom", def("A", 1, 1));
    give(state, "bottom", def("B", 9, 1));
    state.players.bottom.energy = 1;
    expect(legalPlays(state)).toHaveLength(3); // A in three lanes; B is too expensive
  });
});

describe("anchor", () => {
  const anchor = def("ANCHOR", 1, 1, {
    timing: "continuous",
    effect: { kind: "anchor" },
  });

  it("blocks a play that would push, but allows one into an empty entry cell", () => {
    const state = emptyGame();
    setLane(state, 0, [
      null,
      instance(anchor, "top"),
      instance(def("P1", 1, 1), "bottom"),
    ]);
    const x = give(state, "bottom", def("X", 1, 1));
    state.players.bottom.energy = 1;
    expect(canPlay(state, x.uid, 0)).toEqual({ ok: false, reason: "anchored" });
    expect(canPlay(state, x.uid, 1).ok).toBe(true);

    setLane(state, 0, [null, instance(anchor, "top"), null]);
    expect(canPlay(state, x.uid, 0).ok).toBe(true);
    expect(names(playCard(state, x.uid, 0).state.lanes[0])).toEqual([
      "-",
      "ANCHOR",
      "X",
    ]);
  });

  it("applies to the opponent as well", () => {
    const state = emptyGame("top");
    setLane(state, 2, [
      instance(def("E1", 1, 1), "top"),
      null,
      instance(anchor, "bottom"),
    ]);
    give(state, "top", def("Y", 1, 1));
    state.players.top.energy = 1;
    const y = state.players.top.hand[0];
    expect(canPlay(state, y.uid, 2)).toEqual({ ok: false, reason: "anchored" });
  });
});

describe("abilities", () => {
  const play = (
    seat: "bottom" | "top",
    card: ReturnType<typeof def>,
    setup?: (s: ReturnType<typeof emptyGame>) => void,
    lane = 0 as const,
  ) => {
    const state = emptyGame(seat);
    setup?.(state);
    const c = give(state, seat, card);
    state.players[seat].energy = card.cost;
    return playCard(state, c.uid, lane).state;
  };

  it("active draw draws that many cards, and nothing from an empty deck", () => {
    const draw2 = def("W", 1, 1, {
      timing: "active",
      effect: { kind: "draw", count: 2 },
    });
    const after = play("bottom", draw2);
    expect(after.players.bottom.hand).toHaveLength(2);
    const dry = play(
      "bottom",
      draw2,
      (s) => (s.players.bottom.deck = s.players.bottom.deck.slice(0, 1)),
    );
    expect(dry.players.bottom.hand).toHaveLength(1);
  });

  it("active energy gives extra energy this turn and can exceed the per-turn cap", () => {
    const e = def("E", 1, 1, {
      timing: "active",
      effect: { kind: "energy", amount: 2 },
    });
    expect(play("bottom", e).players.bottom.energy).toBe(2);
    const state = emptyGame();
    state.players.bottom.energy = 9;
    const c = give(state, "bottom", e);
    expect(playCard(state, c.uid, 0).state.players.bottom.energy).toBe(10);
  });

  it("buffLane gives the owner's other cards in the lane permanent power, and nobody else", () => {
    const buff = def("B", 1, 1, {
      timing: "active",
      effect: { kind: "buffLane", amount: 2 },
    });
    const after = play("bottom", buff, (s) =>
      setLane(s, 0, [
        instance(def("E", 1, 4), "top"),
        instance(def("F", 1, 1), "bottom"),
        null,
      ]),
    );
    const lane = after.lanes[0];
    expect(lane.map((c) => c?.bonus)).toEqual([0, 2, 0]); // enemy untouched, played card untouched
    expect(effectivePower(after, 0, lane[1]!)).toBe(3);
  });

  it("laneDouble doubles only the owner's cards in that lane, itself included, and does not stack", () => {
    const state = emptyGame();
    const tiger = def("T", 1, 3, {
      timing: "continuous",
      effect: { kind: "laneDouble" },
    });
    setLane(state, 0, [
      instance(def("E", 1, 4), "top"),
      instance(tiger, "bottom"),
      instance(def("F", 1, 2), "bottom"),
    ]);
    expect(totalPower(state, "bottom")).toBe((3 + 2) * 2);
    expect(totalPower(state, "top")).toBe(4);
    setLane(state, 0, [
      instance(tiger, "bottom"),
      instance(tiger, "bottom"),
      instance(def("F", 1, 2), "bottom"),
    ]);
    expect(totalPower(state, "bottom")).toBe((3 + 3 + 2) * 2); // two tigers: still only x2
  });

  it("power never goes below zero", () => {
    const state = emptyGame();
    setLane(state, 0, [null, null, instance(def("W", 1, 1), "bottom", -5)]);
    expect(totalPower(state, "bottom")).toBe(0);
  });
});

describe("turn resolution", () => {
  it("shifts the tide by the board-power difference after a single turn", () => {
    const state = emptyGame();
    setLane(state, 0, [
      instance(def("E", 1, 4), "top"),
      null,
      instance(def("P", 1, 3), "bottom"),
    ]);
    // bottom 3 - top 4 = -1, so the tide moves toward the enemy on the first turn-end.
    const end = endTurn(state, mulberry32(0));
    expect(end.state.turnsPlayed).toBe(1);
    expect(end.state.balance).toBe(49);
    expect(end.state.active).toBe("top");
    expect(end.events.find((e) => e.type === "tide_shifted")).toMatchObject({
      delta: -1,
      balance: 49,
      turn: 1,
    });
  });

  it("every turn resolves — the tide moves after the first player's turn", () => {
    const state = emptyGame();
    setLane(state, 0, [null, null, instance(def("P", 1, 3), "bottom")]);
    const mid = endTurn(state, mulberry32(0));
    expect(mid.state.turnsPlayed).toBe(1); // not only after a full round
    expect(mid.state.balance).toBe(53); // bottom 3 - top 0 = +3
  });

  it("the first player is whoever the game says, and round still bumps per pair of turns", () => {
    let state = emptyGame("top");
    state = endTurn(endTurn(state, mulberry32(0)).state, mulberry32(0)).state;
    expect(state.active).toBe("top");
    expect(state.round).toBe(2);
  });

  it("a forfeit gives the win to the other seat and is not applied twice", () => {
    const state = emptyGame();
    const done = forfeit(state, "bottom");
    expect(done.state.winner).toBe("top");
    expect(done.events).toEqual([
      { type: "game_over", winner: "top", reason: "forfeit" },
    ]);
    expect(forfeit(done.state, "top").events).toEqual([]);
  });
});

describe("describeEvent", () => {
  it("hides the opponent's draws, names who did what, and explains pushes", () => {
    const state = emptyGame();
    setLane(state, 0, [
      instance(def("E1", 1, 5), "top"),
      instance(def("E2", 1, 1), "top"),
      instance(def("P1", 1, 1), "bottom"),
    ]);
    const x = give(state, "bottom", def("X", 1, 1));
    state.players.bottom.energy = 1;
    const { events } = playCard(state, x.uid, 0);
    expect(describeEvent(events[0], "bottom")).toBe(
      "You played X in the Left lane. It pushed off the enemy's E1, which is destroyed.",
    );
    expect(describeEvent(events[0], "top")).toContain("The enemy played X");
    const drew = {
      type: "drew",
      seat: "top",
      uid: 1,
      card: def("Z", 1, 1),
    } as const;
    expect(describeEvent(drew, "bottom")).toBeNull();
    expect(describeEvent(drew, "top")).toBe("You drew Z.");
  });
});

describe("AI", () => {
  const difficulties: Difficulty[] = ["easy", "normal", "hard"];

  it.each(difficulties)(
    "%s only plans plays that are legal at the moment they are made",
    (difficulty) => {
      for (let seed = 1; seed <= 6; seed++) {
        const rng = mulberry32(seed);
        let state = newGame(
          { bottom: realDeck(), top: realDeck() },
          seed % 2 ? "top" : "bottom",
          rng,
        ).state;
        for (let guard = 0; guard < 70 && !state.winner; guard++) {
          let probe = state;
          for (const play of chooseTurn(state, difficulty, rng)) {
            expect(
              canPlay(probe, play.uid, play.lane).ok,
              `${difficulty} seed ${seed}`,
            ).toBe(true);
            probe = playCard(probe, play.uid, play.lane).state;
          }
          state = probe.winner ? probe : endTurn(probe, mulberry32(0)).state;
        }
      }
    },
    30_000,
  );

  it.each(difficulties)(
    "%s plays full games against itself and the games end",
    (difficulty) => {
      for (let seed = 1; seed <= 6; seed++) {
        const rng = mulberry32(seed * 7);
        let state = newGame(
          { bottom: realDeck(), top: realDeck() },
          seed % 2 ? "bottom" : "top",
          rng,
        ).state;
        let turns = 0;
        while (!state.winner) {
          state = playAiTurn(state, difficulty, rng).state;
          expect(++turns).toBeLessThan(MAX_TURNS + 2);
        }
        expect(["bottom", "top", "draw"]).toContain(state.winner);
      }
    },
    30_000,
  );

  it("normal and hard prefer pushing off a strong enemy card over a plain play", () => {
    const state = emptyGame("top");
    // The AI (top seat) enters lane 1 from the top. The lane is full, so its push runs all the way down and destroys BIG.
    setLane(state, 1, [
      instance(def("MY1", 1, 1), "top"),
      instance(def("MY2", 1, 1), "top"),
      instance(def("BIG", 1, 9), "bottom"),
    ]);
    give(state, "top", def("PUSH", 1, 1));
    state.players.top.energy = 1;
    for (const difficulty of ["normal", "hard"] as const) {
      const after = playAiTurn(state, difficulty, mulberry32(2)).state;
      const survivors = after.lanes
        .flat()
        .filter((c): c is CardInstance => c !== null)
        .map((c) => c.def.id);
      expect(survivors, difficulty).not.toContain("BIG");
      expect(survivors, difficulty).toContain("PUSH");
    }
  });

  it("evaluate rewards board power and a favourable tide, without reading HP", () => {
    const state = emptyGame();
    const base = evaluate(state, "bottom");
    // A bigger board advantage for `me` scores higher.
    setLane(state, 0, [null, null, instance(def("P", 1, 5), "bottom")]);
    const withBoard = evaluate(state, "bottom");
    expect(withBoard).toBeGreaterThan(base);
    // A higher balance favours bottom, so bumping it raises bottom's score further.
    const leaning = structuredClone(state);
    leaning.balance = 80;
    expect(evaluate(leaning, "bottom")).toBeGreaterThan(withBoard);
    // The same higher balance is worse for top (seat-fixed direction).
    expect(evaluate(leaning, "top")).toBeLessThan(evaluate(state, "top"));
  });
});

describe("hand cap (MAX_HAND) and the burned event", () => {
  const fill = (state: GameState, seat: "bottom" | "top", n: number) => {
    for (let i = 0; i < n; i++)
      state.players[seat].hand.push(instance(def(`h${i}`, 1, 1), seat));
  };

  it("burns a start-of-turn draw into a full hand instead of a 7th card", () => {
    const state = emptyGame("bottom");
    fill(state, "top", MAX_HAND);
    expect(state.players.top.deck.length).toBeGreaterThan(0);
    state.active = "bottom";
    const deckBefore = state.players.top.deck.length;

    // Control passes to top, whose startTurn draws 1 — into a hand already at the cap.
    const { state: next, events } = endTurn(state, mulberry32(0));

    expect(next.players.top.hand.length).toBe(MAX_HAND);
    expect(next.players.top.deck.length).toBe(deckBefore - 1);
    expect(events.some((e) => e.type === "burned" && e.seat === "top")).toBe(
      true,
    );
  });

  it("burns a Phoenix revival into a full hand (no tally, hand stays at the cap)", () => {
    const state = emptyGame();
    const phoenix = def("PHX", 4, 4, {
      timing: "onDestroy",
      effect: { kind: "rebirth", amount: 4 },
    });
    fill(state, "top", MAX_HAND);
    // A full lane with the Phoenix on the top edge, so a bottom push shoves it off and destroys it.
    setLane(state, 0, [
      instance(phoenix, "top"),
      instance(def("E2", 1, 1), "top"),
      instance(def("P1", 1, 1), "bottom"),
    ]);
    const x = give(state, "bottom", def("X", 1, 1));
    const powerBefore = state.destroyedPower;
    const countBefore = state.destroyedCount;

    const { state: after, events } = playCard(state, x.uid, 0);

    expect(after.players.top.hand.length).toBe(MAX_HAND);
    expect(after.players.top.hand.some((c) => c.def.id === "PHX")).toBe(false);
    expect(after.destroyedPower).toBe(powerBefore);
    expect(after.destroyedCount).toBe(countBefore);
    expect(events.some((e) => e.type === "burned" && e.seat === "top")).toBe(
      true,
    );
  });

  it("still returns a Phoenix to a hand with room (regression)", () => {
    const state = emptyGame();
    const phoenix = def("PHX", 4, 4, {
      timing: "onDestroy",
      effect: { kind: "rebirth", amount: 4 },
    });
    fill(state, "top", MAX_HAND - 1); // one free slot
    setLane(state, 0, [
      instance(phoenix, "top"),
      instance(def("E2", 1, 1), "top"),
      instance(def("P1", 1, 1), "bottom"),
    ]);
    const x = give(state, "bottom", def("X", 1, 1));

    const { state: after, events } = playCard(state, x.uid, 0);

    expect(after.players.top.hand.length).toBe(MAX_HAND);
    const revived = after.players.top.hand.find((c) => c.def.id === "PHX");
    expect(revived).toBeDefined();
    expect(revived!.bonus).toBe(4);
    expect(events.some((e) => e.type === "burned")).toBe(false);
  });

  it("gives both seats a legal opening hand within the cap", () => {
    const { state } = newGame(
      { bottom: realDeck(), top: realDeck() },
      "bottom",
      mulberry32(7),
    );
    // The first (active) seat draws its opening hand plus the one start-of-turn draw.
    expect(state.players.bottom.hand.length).toBe(OPENING_HAND.first + 1);
    expect(state.players.top.hand.length).toBe(OPENING_HAND.second);
    expect(state.players.bottom.hand.length).toBeLessThanOrEqual(MAX_HAND);
    expect(state.players.top.hand.length).toBeLessThanOrEqual(MAX_HAND);
  });

  it("burns the overflow when a draw-ability draws past the cap", () => {
    const state = emptyGame();
    const drawCard = def("DRAW", 1, 1, {
      timing: "active",
      effect: { kind: "draw", count: 2 },
    });
    fill(state, "bottom", MAX_HAND - 1); // one free slot plus the card we play below leaves room for exactly one draw
    // Playing DRAW removes it from hand first, so the hand sits at MAX_HAND-1 when the ability draws 2.
    const card = give(state, "bottom", drawCard);
    const deckBefore = state.players.bottom.deck.length;

    const { state: after, events } = playCard(state, card.uid, 0);

    expect(after.players.bottom.hand.length).toBe(MAX_HAND);
    expect(after.players.bottom.deck.length).toBe(deckBefore - 2);
    expect(
      events.filter((e) => e.type === "burned" && e.seat === "bottom").length,
    ).toBe(1);
  });
});

describe("placeholder cards", () => {
  it("are well formed", () => {
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
    for (const c of CARDS) {
      expect(c.cost, c.id).toBeGreaterThanOrEqual(1);
      expect(c.power, c.id).toBeGreaterThanOrEqual(0);
    }
    expect(CARDS.length).toBeGreaterThanOrEqual(12);
  });
});

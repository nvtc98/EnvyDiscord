import { describe, expect, it } from "vitest";
import { parseAbility } from "../src/data/ability-parse";
import { CARDS } from "../src/data/cards";
import { evaluate } from "../src/engine/ai";
import { endTurn, forfeit, totalPower } from "../src/engine/rules";
import { MAX_TURNS } from "../src/engine/types";
import { mulberry32 } from "../src/util/rng";
import { def, emptyGame, instance, setLane } from "./engine-helpers";

const tide = (events: ReturnType<typeof endTurn>["events"]) =>
  events.find((e) => e.type === "tide_shifted");

describe("tide shift sign and magnitude", () => {
  it("moves toward bottom when bottom's board is ahead", () => {
    const state = emptyGame();
    setLane(state, 0, [
      instance(def("E", 1, 3), "top"),
      null,
      instance(def("P", 1, 8), "bottom"),
    ]);
    expect(totalPower(state, "bottom") - totalPower(state, "top")).toBe(5);
    const { state: after, events } = endTurn(state, mulberry32(0));
    expect(after.balance).toBe(55);
    expect(tide(events)).toMatchObject({ delta: 5, balance: 55, turn: 1 });
  });

  it("moves toward top when top's board is ahead", () => {
    const state = emptyGame();
    setLane(state, 0, [
      instance(def("E", 1, 7), "top"),
      null,
      instance(def("P", 1, 2), "bottom"),
    ]);
    const { state: after, events } = endTurn(state, mulberry32(0));
    expect(after.balance).toBe(45);
    expect(tide(events)).toMatchObject({ delta: -5, balance: 45, turn: 1 });
  });

  it("holds when the boards are even", () => {
    const state = emptyGame();
    setLane(state, 0, [
      instance(def("E", 1, 4), "top"),
      null,
      instance(def("P", 1, 4), "bottom"),
    ]);
    const { state: after, events } = endTurn(state, mulberry32(0));
    expect(after.balance).toBe(50);
    expect(tide(events)).toMatchObject({ delta: 0, balance: 50, turn: 1 });
  });
});

describe("single global balance coefficient (super reactionary)", () => {
  // A coefficient card via the balanceCoefficient ability (Card D's carrier).
  const coeffAbility = (k: number) =>
    def(`k${k}`, 1, 0, {
      timing: "continuous",
      effect: { kind: "balanceCoefficient", k },
    });
  // A coefficient card via the CardDef.coefficient field (Cards B/C's carrier).
  const coeffField = (k: number) => ({ ...def(`f${k}`, 1, 0), coefficient: k });

  it("the worked example: balance 40, A 10 / B 5, one k=2 card → k=3, delta +15 → 55", () => {
    const state = emptyGame();
    state.balance = 40;
    setLane(state, 0, [
      instance(def("E", 1, 5), "top"),
      instance(coeffAbility(2), "bottom"),
      instance(def("P", 1, 10), "bottom"),
    ]);
    // bottom total = 10 (the k-card has 0 power); top total = 5; diff = +5; k = 1 + 2 = 3.
    expect(totalPower(state, "bottom") - totalPower(state, "top")).toBe(5);
    const { state: after, events } = endTurn(state, mulberry32(0));
    expect(after.balance).toBe(55);
    expect(tide(events)).toMatchObject({ delta: 15, balance: 55 });
  });

  it("no coefficient cards keeps the baseline k=1 (delta = Pb - Pt)", () => {
    const state = emptyGame();
    setLane(state, 0, [
      instance(def("E", 1, 3), "top"),
      null,
      instance(def("P", 1, 8), "bottom"),
    ]);
    const { events } = endTurn(state, mulberry32(0));
    expect(tide(events)).toMatchObject({ delta: 5 });
  });

  it("a k=2 card gives the identical delta whichever seat owns it (ownership-independent)", () => {
    const build = (owner: "bottom" | "top") => {
      const state = emptyGame();
      state.balance = 40;
      setLane(state, 0, [
        instance(def("E", 1, 5), "top"),
        instance(coeffAbility(2), owner),
        instance(def("P", 1, 10), "bottom"),
      ]);
      return endTurn(state, mulberry32(0));
    };
    expect(tide(build("bottom").events)).toMatchObject({ delta: 15 });
    expect(tide(build("top").events)).toMatchObject({ delta: 15 });
  });

  it("coefficients from both seats add into one k (additive)", () => {
    const state = emptyGame();
    // bottom has a k=1 field-carrier, top has a k=2 ability-carrier → k = 1 + 1 + 2 = 4.
    setLane(state, 0, [
      instance(coeffAbility(2), "top"),
      instance(coeffField(1), "bottom"),
      instance(def("P", 1, 5), "bottom"),
    ]);
    // bottom total = 5, top total = 0 → diff +5, k = 4 → delta +20.
    expect(totalPower(state, "bottom") - totalPower(state, "top")).toBe(5);
    const { events } = endTurn(state, mulberry32(0));
    expect(tide(events)).toMatchObject({ delta: 20 });
  });

  it("removing a coefficient card from the board drops its contribution next resolution", () => {
    const state = emptyGame();
    setLane(state, 0, [
      instance(def("E", 1, 5), "top"),
      instance(coeffField(2), "bottom"),
      instance(def("P", 1, 10), "bottom"),
    ]);
    // With the k=2 card: diff +5, k=3 → delta +15.
    expect(tide(endTurn(state, mulberry32(0)).events)).toMatchObject({
      delta: 15,
    });
    // Remove it: diff +5, k=1 → delta +5.
    setLane(state, 0, [
      instance(def("E", 1, 5), "top"),
      null,
      instance(def("P", 1, 10), "bottom"),
    ]);
    expect(tide(endTurn(state, mulberry32(0)).events)).toMatchObject({
      delta: 5,
    });
  });
});

describe("clamp", () => {
  it("reports only the applied shift when the balance hits 100", () => {
    const state = emptyGame();
    state.balance = 98;
    setLane(state, 0, [null, null, instance(def("P", 1, 5), "bottom")]);
    const { state: after, events } = endTurn(state, mulberry32(0));
    expect(after.balance).toBe(100);
    expect(tide(events)).toMatchObject({ delta: 2, balance: 100 });
  });

  it("reports only the applied shift when the balance hits 0", () => {
    const state = emptyGame();
    state.balance = 2;
    setLane(state, 0, [null, null, instance(def("E", 1, 5), "top")]);
    const { state: after, events } = endTurn(state, mulberry32(0));
    expect(after.balance).toBe(0);
    expect(tide(events)).toMatchObject({ delta: -2, balance: 0 });
  });
});

describe("knockout", () => {
  it("bottom wins when the balance reaches 100, and the game is over", () => {
    const state = emptyGame();
    state.balance = 97;
    setLane(state, 0, [null, null, instance(def("P", 1, 5), "bottom")]);
    const { state: after, events } = endTurn(state, mulberry32(0));
    expect(after.winner).toBe("bottom");
    expect(events.at(-1)).toMatchObject({
      type: "game_over",
      winner: "bottom",
      reason: "balance",
    });
    expect(() => endTurn(after, mulberry32(0))).toThrow();
  });

  it("top wins when the balance reaches 0", () => {
    const state = emptyGame();
    state.balance = 3;
    setLane(state, 0, [null, null, instance(def("E", 1, 5), "top")]);
    const { state: after } = endTurn(state, mulberry32(0));
    expect(after.winner).toBe("top");
  });
});

describe("18-turn cap", () => {
  const resolveAt = (balance: number) => {
    const state = emptyGame();
    state.turnsPlayed = MAX_TURNS - 1;
    state.balance = balance;
    return endTurn(state, mulberry32(0));
  };

  it("bottom wins the cap when leading the tide", () => {
    const { state, events } = resolveAt(60);
    expect(state.turnsPlayed).toBe(MAX_TURNS);
    expect(state.winner).toBe("bottom");
    expect(events.at(-1)).toMatchObject({
      type: "game_over",
      winner: "bottom",
      reason: "turns",
    });
  });

  it("top wins the cap when leading the tide", () => {
    const { state } = resolveAt(40);
    expect(state.winner).toBe("top");
  });

  it("an even tide at the cap is a draw", () => {
    const { state, events } = resolveAt(50);
    expect(state.winner).toBe("draw");
    expect(events.at(-1)).toMatchObject({ winner: "draw", reason: "turns" });
  });
});

describe("forfeit", () => {
  it("hands the win to the other seat immediately", () => {
    const state = emptyGame();
    const { state: after, events } = forfeit(state, "bottom");
    expect(after.winner).toBe("top");
    expect(events).toEqual([
      { type: "game_over", winner: "top", reason: "forfeit" },
    ]);
  });
});

describe("removed ability tokens", () => {
  it.each(["heal 3", "damage 2", "healRound 1"])(
    "parseAbility(%s) throws unknown ability token",
    (shorthand) => {
      expect(() => parseAbility(shorthand, "X")).toThrow(
        /unknown ability token/,
      );
    },
  );

  it("no card uses the removed shorthand", () => {
    for (const card of CARDS) {
      const ability = card.ability;
      if (!ability) continue;
      expect(ability.effect.kind).not.toBe("heal");
      expect(ability.effect.kind).not.toBe("damage");
    }
  });
});

describe("every turn resolves", () => {
  it("bumps turnsPlayed and moves the tide after the first player's single endTurn", () => {
    const state = emptyGame("bottom");
    setLane(state, 0, [null, null, instance(def("P", 1, 4), "bottom")]);
    const { state: after, events } = endTurn(state, mulberry32(0));
    expect(after.turnsPlayed).toBe(1);
    expect(after.balance).toBe(54);
    expect(tide(events)).toMatchObject({ turn: 1 });
  });
});

describe("evaluate uses board power and tide, not HP", () => {
  it("scores a bigger board advantage and a favourable tide higher", () => {
    const state = emptyGame();
    const base = evaluate(state, "bottom");
    setLane(state, 0, [null, null, instance(def("P", 1, 6), "bottom")]);
    const withBoard = evaluate(state, "bottom");
    expect(withBoard).toBeGreaterThan(base);
    const leaning = structuredClone(state);
    leaning.balance = 90;
    expect(evaluate(leaning, "bottom")).toBeGreaterThan(withBoard);
  });
});

import { describe, expect, it } from "vitest";

import { endTurn } from "../src/engine/rules";
import type { Ability, GameEvent, GameState } from "../src/engine/types";
import { mulberry32 } from "../src/util/rng";
import { def, emptyGame, instance, setLane } from "./engine-helpers";

// Mirrors the `opticGain` shorthand token in cards.json.
const opticGain = (): Ability => ({
  timing: "active",
  effect: { kind: "opticGain" },
});

const find = (state: GameState, id: string) =>
  state.lanes
    .flat()
    .find((c): c is NonNullable<typeof c> => c !== null && c.def.id === id);

const abilityTexts = (events: readonly GameEvent[]) =>
  events
    .filter(
      (e): e is Extract<GameEvent, { type: "ability" }> => e.type === "ability",
    )
    .map((e) => e.text);

describe("Optic Eyes / opticGain", () => {
  it("gains nothing when alone in its lane", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const optic = instance(def("OPTIC", 2, 2, opticGain()), "bottom");
    setLane(state, 0, [null, null, optic]);
    const { state: after, events } = endTurn(state, mulberry32(1));
    expect(find(after, "OPTIC")?.bonus).toBe(0);
    expect(abilityTexts(events).some((t) => t.startsWith("gained"))).toBe(
      false,
    );
  });

  it("gains the cost of the one other friendly card in its lane", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const optic = instance(def("OPTIC", 2, 2, opticGain()), "bottom");
    const ally = instance(def("ALLY", 5, 1), "bottom");
    setLane(state, 0, [null, ally, optic]);
    const { state: after, events } = endTurn(state, mulberry32(1));
    expect(find(after, "OPTIC")?.bonus).toBe(5);
    expect(abilityTexts(events)).toContain("gained 5 power from ALLY");
  });

  it("gains the cost of the one other ENEMY card in its lane", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const optic = instance(def("OPTIC", 2, 2, opticGain()), "bottom");
    const enemy = instance(def("ENEMY", 7, 1), "top");
    setLane(state, 0, [enemy, null, optic]);
    const { state: after, events } = endTurn(state, mulberry32(1));
    expect(find(after, "OPTIC")?.bonus).toBe(7);
    expect(abilityTexts(events)).toContain("gained 7 power from ENEMY");
  });

  it("picks one of the other cards' costs when several share the lane (seeded, deterministic)", () => {
    const build = (): GameState => {
      const state = emptyGame("bottom");
      state.active = "bottom";
      const optic = instance(def("OPTIC", 2, 2, opticGain()), "bottom");
      const a = instance(def("A", 3, 1), "bottom");
      const b = instance(def("B", 6, 1), "top");
      setLane(state, 0, [b, a, optic]);
      return state;
    };
    const run = () => endTurn(build(), mulberry32(42));
    const { state: after } = run();
    const gained = find(after, "OPTIC")?.bonus ?? -1;
    // It gains exactly ONE of the two other costs (3 or 6), once.
    expect([3, 6]).toContain(gained);
    // Same seed → same choice every time.
    const { state: again } = run();
    expect(find(again, "OPTIC")?.bonus).toBe(gained);
  });
});

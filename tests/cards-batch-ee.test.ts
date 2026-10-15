import { describe, expect, it } from "vitest";
import {
  canPlay,
  endTurn,
  legalPlays,
  spreadPowerRandomly,
  tallyDestroyed,
} from "../src/engine/rules";
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
const joyfulBuff = (): Ability => ({
  timing: "active",
  effect: { kind: "joyfulBuff" },
});
const goliathGain = (): Ability => ({
  timing: "active",
  effect: { kind: "goliathGain" },
});
const frozenLock = (): Ability => ({
  timing: "active",
  effect: { kind: "frozenLock" },
});
const gloomLane = (): Ability => ({
  timing: "active",
  effect: { kind: "gloomLane" },
});
const sunkenPull = (): Ability => ({
  timing: "active",
  effect: { kind: "sunkenPull" },
});
const killingDeck = (): Ability => ({
  timing: "active",
  effect: { kind: "killingDeck" },
});
const numbDeck = (): Ability => ({
  timing: "active",
  effect: { kind: "numbDeck" },
});
const sunlitScatter = (): Ability => ({
  timing: "active",
  effect: { kind: "sunlitScatter" },
});
const flowerBuff = (): Ability => ({
  timing: "endOfRound",
  effect: { kind: "flowerBuff" },
});
const dispersedSpread = (): Ability => ({
  timing: "onDestroy",
  effect: { kind: "dispersedSpread" },
});
const guardianLane = (): Ability => ({
  timing: "continuous",
  effect: { kind: "guardianLane" },
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
const abilityTexts = (events: readonly GameEvent[]) =>
  events
    .filter(
      (e): e is Extract<GameEvent, { type: "ability" }> => e.type === "ability",
    )
    .map((e) => e.text);
const setDeck = (
  state: GameState,
  seat: Seat,
  entries: { def: CardDef; bonus: number }[],
) => {
  state.players[seat].deck = entries;
};

// =============================================================================
// Part 0 — tallyDestroyed
// =============================================================================
describe("tallyDestroyed (Part 0)", () => {
  it("adds effective power and increments the count", () => {
    const state = emptyGame("bottom");
    const before = {
      power: state.destroyedPower,
      count: state.destroyedCount,
    };
    tallyDestroyed(state, def("X", 1, 7), 3); // effective 10
    expect(state.destroyedPower).toBe(before.power + 10);
    expect(state.destroyedCount).toBe(before.count + 1);
  });

  it("floors negative-effective power at 0 but still counts", () => {
    const state = emptyGame("bottom");
    tallyDestroyed(state, def("Y", 1, 1), -5); // effective max(0, 1-5) = 0
    expect(state.destroyedPower).toBe(0);
    expect(state.destroyedCount).toBe(1);
  });
});

// =============================================================================
// Part 1 — spreadPowerRandomly
// =============================================================================
describe("spreadPowerRandomly (Part 1)", () => {
  const targets = () => [
    instance(def("A", 1, 1), "bottom"),
    instance(def("B", 1, 1), "bottom"),
    instance(def("C", 1, 1), "bottom"),
  ];

  it("distributes exactly `total` points across the targets", () => {
    const t = targets();
    const dealt = spreadPowerRandomly(t, 30, mulberry32(1));
    expect(dealt).toBe(30);
    expect(t.reduce((n, c) => n + c.bonus, 0)).toBe(30);
    for (const c of t) expect(c.bonus).toBeGreaterThanOrEqual(0);
    for (const c of t) expect(c.bonus).toBeLessThanOrEqual(30);
  });

  it("is deterministic for equal seeds", () => {
    const a = targets();
    const b = targets();
    spreadPowerRandomly(a, 20, mulberry32(42));
    spreadPowerRandomly(b, 20, mulberry32(42));
    expect(a.map((c) => c.bonus)).toEqual(b.map((c) => c.bonus));
  });

  it("empty target list → nothing distributed", () => {
    expect(spreadPowerRandomly([], 10, mulberry32(1))).toBe(0);
  });

  it("total <= 0 → nothing changes", () => {
    const t = targets();
    expect(spreadPowerRandomly(t, 0, mulberry32(1))).toBe(0);
    expect(spreadPowerRandomly(t, -5, mulberry32(1))).toBe(0);
    expect(t.reduce((n, c) => n + c.bonus, 0)).toBe(0);
  });
});

// =============================================================================
// Sunlit Eyes (sunlitScatter)
// =============================================================================
describe("Sunlit Eyes / sunlitScatter", () => {
  it("destroys other friendly board cards (feeding Stella) and spreads power across the hand; Sunlit survives", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const sunlit = instance(def("SUN", 6, 4, sunlitScatter()), "bottom");
    const ally1 = instance(def("A1", 1, 6), "bottom");
    const ally2 = instance(def("A2", 1, 4), "bottom");
    setLane(state, 0, [null, null, sunlit]);
    setLane(state, 1, [null, null, ally1]);
    setLane(state, 2, [null, null, ally2]);
    const h1 = instance(def("H1", 1, 0), "bottom");
    const h2 = instance(def("H2", 1, 0), "bottom");
    state.players.bottom.hand = [h1, h2];
    const before = {
      power: state.destroyedPower,
      count: state.destroyedCount,
    };
    const { state: after } = endTurn(state, mulberry32(1));
    // Sunlit alive; both allies destroyed.
    expect(find(after, sunlit.uid)).toBeTruthy();
    expect(find(after, ally1.uid)).toBeUndefined();
    expect(find(after, ally2.uid)).toBeUndefined();
    // Both destroyed via destroyCard → Stella grows by 6 + 4 = 10, count +2.
    expect(after.destroyedPower).toBe(before.power + 10);
    expect(after.destroyedCount).toBe(before.count + 2);
    // The 10 is spread across the two hand cards.
    const hand = after.players.bottom.hand;
    expect(hand.reduce((n, c) => n + c.bonus, 0)).toBe(10);
  });

  it("destroyed Phoenix victim returns to hand (onDestroy fires via destroyCard)", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const sunlit = instance(def("SUN", 6, 4, sunlitScatter()), "bottom");
    const phx = instance(def("PHX", 1, 3, phoenix(4)), "bottom");
    setLane(state, 0, [null, null, sunlit]);
    setLane(state, 1, [null, null, phx]);
    state.players.bottom.hand = [];
    const { state: after } = endTurn(state, mulberry32(1));
    // Phoenix returned to hand; it is no longer on the board.
    expect(find(after, phx.uid)).toBeUndefined();
    expect(after.players.bottom.hand.some((c) => c.def.id === "PHX")).toBe(
      true,
    );
  });

  it("empty hand → destroyed power is lost (no crash, Sunlit survives)", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const sunlit = instance(def("SUN", 6, 4, sunlitScatter()), "bottom");
    const ally = instance(def("A", 1, 9), "bottom");
    setLane(state, 0, [null, null, sunlit]);
    setLane(state, 1, [null, null, ally]);
    state.players.bottom.hand = [];
    const { state: after } = endTurn(state, mulberry32(1));
    expect(find(after, sunlit.uid)).toBeTruthy();
    expect(find(after, ally.uid)).toBeUndefined();
    expect(after.players.bottom.hand.length).toBe(0);
  });
});

// =============================================================================
// Dispersed Eyes (dispersedSpread)
// =============================================================================
describe("Dispersed Eyes / dispersedSpread", () => {
  it("spreads its power across other friendly board cards when destroyed, and still feeds Stella", () => {
    // Sunlit destroys Dispersed; Dispersed's onDestroy spreads its power to the remaining ally.
    const state = emptyGame("bottom");
    state.active = "bottom";
    const sunlit = instance(def("SUN", 6, 4, sunlitScatter()), "bottom");
    const disp = instance(def("DISP", 4, 7, dispersedSpread()), "bottom");
    const ally = instance(def("ALLY", 1, 0), "bottom");
    setLane(state, 0, [null, null, sunlit]);
    setLane(state, 1, [null, null, disp]);
    setLane(state, 2, [null, null, ally]);
    state.players.bottom.hand = [];
    const before = state.destroyedCount;
    const { state: after } = endTurn(state, mulberry32(1));
    // Dispersed and the plain ally are destroyed by Sunlit. Dispersed spreads its 7 power to the
    // remaining friendly board cards at the moment of its destruction (ALLY if visited first).
    expect(find(after, disp.uid)).toBeUndefined();
    // Stella counted both Sunlit's victims (ALLY + DISP).
    expect(after.destroyedCount).toBe(before + 2);
  });

  it("no other friendly board cards → power lost, no crash", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const sunlit = instance(def("SUN", 6, 4, sunlitScatter()), "bottom");
    const disp = instance(def("DISP", 4, 7, dispersedSpread()), "bottom");
    setLane(state, 0, [null, null, sunlit]);
    setLane(state, 1, [null, null, disp]);
    state.players.bottom.hand = [];
    const { state: after, events } = endTurn(state, mulberry32(1));
    expect(find(after, disp.uid)).toBeUndefined();
    expect(find(after, sunlit.uid)).toBeTruthy();
    // Dispersed emitted its scatter line even with nothing to receive.
    expect(
      events.some((e) => e.type === "ability" && e.card?.id === "DISP"),
    ).toBe(true);
  });
});

// =============================================================================
// Flower Eyes (flowerBuff)
// =============================================================================
describe("Flower Eyes / flowerBuff", () => {
  it("gives +1 to exactly one friendly card at end of turn", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const flower = instance(def("FLW", 1, 2, flowerBuff()), "bottom");
    const ally = instance(def("A", 1, 1), "bottom");
    setLane(state, 0, [null, null, flower]);
    setLane(state, 1, [null, null, ally]);
    const { state: after } = endTurn(state, mulberry32(1));
    const total = onBoard(after)
      .filter((c) => c.owner === "bottom")
      .reduce((n, c) => n + c.bonus, 0);
    expect(total).toBe(1); // exactly one +1 handed out
  });

  it("is deterministic for equal seeds", () => {
    const build = () => {
      const state = emptyGame("bottom");
      state.active = "bottom";
      setLane(state, 0, [
        null,
        null,
        instance(def("FLW", 1, 2, flowerBuff()), "bottom"),
      ]);
      setLane(state, 1, [null, null, instance(def("X", 1, 1), "bottom")]);
      setLane(state, 2, [null, null, instance(def("Y", 1, 1), "bottom")]);
      return state;
    };
    const a = endTurn(build(), mulberry32(5));
    const b = endTurn(build(), mulberry32(5));
    const bonuses = (s: GameState) =>
      onBoard(s)
        .map((c) => c.bonus)
        .sort((x, y) => x - y);
    expect(bonuses(a.state)).toEqual(bonuses(b.state));
  });
});

// =============================================================================
// Joyful Eyes (joyfulBuff)
// =============================================================================
describe("Joyful Eyes / joyfulBuff", () => {
  it("gives +1 to all friendly cards (self included), leaving enemies untouched", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const joyful = instance(def("JOY", 3, 3, joyfulBuff()), "bottom");
    const ally = instance(def("A", 1, 1), "bottom");
    const enemy = instance(def("E", 1, 1), "top");
    setLane(state, 0, [enemy, null, joyful]);
    setLane(state, 1, [null, null, ally]);
    const { state: after } = endTurn(state, mulberry32(1));
    expect(find(after, joyful.uid)!.bonus).toBe(1);
    expect(find(after, ally.uid)!.bonus).toBe(1);
    expect(find(after, enemy.uid)!.bonus).toBe(0);
  });
});

// =============================================================================
// Goliath Eyes (goliathGain)
// =============================================================================
describe("Goliath Eyes / goliathGain", () => {
  const runGoliath = (owner: Seat, balance: number) => {
    const state = emptyGame(owner);
    state.active = owner;
    state.balance = balance; // total HP is 100 (50 + 50 default)
    const goliath = instance(def("GOL", 5, 0, goliathGain()), owner);
    // A lone power-0 Goliath keeps board power 0 on both sides, so the tide does not move.
    setLane(state, 0, [
      owner === "bottom" ? null : goliath,
      null,
      owner === "bottom" ? goliath : null,
    ]);
    return { goliath, step: endTurn(state, mulberry32(1)) };
  };

  it("bottom owner at 15/100 gains +9 (round(8.5) rounds up)", () => {
    const { goliath, step } = runGoliath("bottom", 15);
    expect(find(step.state, goliath.uid)!.bonus).toBe(9);
  });

  it("bottom owner at 99/100 gains +0 (round(0.1) = 0)", () => {
    const { goliath, step } = runGoliath("bottom", 99);
    expect(find(step.state, goliath.uid)!.bonus).toBe(0);
  });

  it("top owner is seat-correct (mirrored balance gives the symmetric gain)", () => {
    // Top owner at balance 85 → top HP = 100 - 85 = 15 → round(8.5) = +9, same as bottom at 15.
    const { goliath, step } = runGoliath("top", 85);
    expect(find(step.state, goliath.uid)!.bonus).toBe(9);
  });
});

// =============================================================================
// Frozen Eyes (frozenLock)
// =============================================================================
describe("Frozen Eyes / frozenLock", () => {
  it("locks the opponent's next turn and the owner's own next turn, then clears", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const frozen = instance(def("FRZ", 2, 4, frozenLock()), "bottom");
    setLane(state, 0, [null, null, frozen]);
    // Give both players a card to attempt playing.
    state.players.bottom.hand = [instance(def("HB", 1, 1), "bottom")];
    state.players.top.hand = [instance(def("HT", 1, 1), "top")];

    // Bottom ends its turn → Frozen resolves, turnLock = 3; top's startTurn decrements 3 → 2.
    const a = endTurn(state, mulberry32(1));
    expect(a.state.turnLock).toBe(2);
    expect(a.state.active).toBe("top");
    // Ply 1: the opponent (top) cannot play anything.
    expect(legalPlays(a.state)).toEqual([]);
    const topUid = a.state.players.top.hand[0].uid;
    expect(canPlay(a.state, topUid, 0).ok).toBe(false);

    // Top ends its turn → bottom's startTurn decrements 2 → 1 (still locked).
    const b = endTurn(a.state, mulberry32(1));
    expect(b.state.turnLock).toBe(1);
    expect(b.state.active).toBe("bottom");
    // Ply 2: the owner's (bottom) own next turn is ALSO locked.
    expect(legalPlays(b.state)).toEqual([]);
    const botUid = b.state.players.bottom.hand[0].uid;
    expect(canPlay(b.state, botUid, 0).ok).toBe(false);

    // Remove Frozen so it does not re-arm the lock at bottom's end of turn, isolating the clear.
    setLane(b.state, 0, [null, null, null]);
    // Bottom ends its turn → top's startTurn decrements 1 → 0; the lock has now cleared.
    const c = endTurn(b.state, mulberry32(1));
    expect(c.state.turnLock).toBe(0);
    expect(c.state.active).toBe("top");
    const topUid2 = c.state.players.top.hand[0].uid;
    expect(canPlay(c.state, topUid2, 0).ok).toBe(true);
  });
});

// =============================================================================
// Gloom Eyes (gloomLane)
// =============================================================================
describe("Gloom Eyes / gloomLane", () => {
  it("drains 1 power from every enemy card in its lane, leaving friendlies and other lanes alone", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const gloom = instance(def("GLM", 1, 1, gloomLane()), "bottom");
    const enemyInLane = instance(def("EL", 1, 5), "top");
    const enemyOther = instance(def("EO", 1, 5), "top");
    const allyInLane = instance(def("AL", 1, 5), "bottom");
    setLane(state, 0, [enemyInLane, allyInLane, gloom]);
    setLane(state, 1, [enemyOther, null, null]);
    const { state: after } = endTurn(state, mulberry32(1));
    expect(find(after, enemyInLane.uid)!.bonus).toBe(-1);
    expect(find(after, allyInLane.uid)!.bonus).toBe(0);
    expect(find(after, enemyOther.uid)!.bonus).toBe(0);
  });

  it("floors effective power at 0 (bonus can go negative but power reads 0)", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const gloom = instance(def("GLM", 1, 1, gloomLane()), "bottom");
    const weak = instance(def("W", 1, 0), "top");
    setLane(state, 0, [weak, null, gloom]);
    const { state: after } = endTurn(state, mulberry32(1));
    expect(find(after, weak.uid)!.bonus).toBe(-1); // effective max(0, 0-1) = 0
  });
});

// =============================================================================
// Sunken Eyes (sunkenPull)
// =============================================================================
describe("Sunken Eyes / sunkenPull", () => {
  it("pulls the two other lanes one step toward the owner's edge; own lane untouched", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    // Sunken in lane 0 (its own lane stays put). Bottom's near edge is cell 2.
    const sunken = instance(def("SNK", 3, 16, sunkenPull()), "bottom");
    setLane(state, 0, [null, null, sunken]);
    // Lane 1: a card at cell 1 → pulled to cell 2 (toward bottom).
    const mover1 = instance(def("M1", 1, 1), "bottom");
    setLane(state, 1, [null, mover1, null]);
    // Lane 2: a card at cell 0 → pulled to cell 1.
    const mover2 = instance(def("M2", 1, 1), "top");
    setLane(state, 2, [mover2, null, null]);
    const { state: after, events } = endTurn(state, mulberry32(1));
    // Sunken unmoved.
    expect(after.lanes[0][2]?.uid).toBe(sunken.uid);
    // Movers slid one step toward bottom.
    expect(after.lanes[1][2]?.uid).toBe(mover1.uid);
    expect(after.lanes[2][1]?.uid).toBe(mover2.uid);
    expect(events.some((e) => e.type === "moved")).toBe(true);
  });

  it("a card at the owner's near edge pulled further falls off and is destroyed (feeds Stella)", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const sunken = instance(def("SNK", 3, 16, sunkenPull()), "bottom");
    setLane(state, 0, [null, null, sunken]);
    // Lane 1: a card already at bottom's near edge (cell 2) → pulled off the board.
    const edge = instance(def("EDGE", 1, 9), "bottom");
    setLane(state, 1, [null, null, edge]);
    const before = state.destroyedCount;
    const { state: after } = endTurn(state, mulberry32(1));
    expect(find(after, edge.uid)).toBeUndefined();
    expect(after.destroyedCount).toBe(before + 1);
  });

  it("a Guardian-protected card at the near edge walls the pull (survives)", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const sunken = instance(def("SNK", 3, 16, sunkenPull()), "bottom");
    setLane(state, 0, [null, null, sunken]);
    // Lane 1: a friendly Guardian at bottom's near edge protects its own lane.
    const guard = instance(def("GRD", 5, 10, guardianLane()), "bottom");
    setLane(state, 1, [null, null, guard]);
    const { state: after } = endTurn(state, mulberry32(1));
    expect(find(after, guard.uid)).toBeTruthy(); // walled, not destroyed
  });
});

// =============================================================================
// Killing Eyes (killingDeck)
// =============================================================================
describe("Killing Eyes / killingDeck", () => {
  it("destroys a random enemy deck card, feeds Stella, and logs its name", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const killing = instance(def("KIL", 2, 5, killingDeck()), "bottom");
    setLane(state, 0, [null, null, killing]);
    setDeck(state, "top", [{ def: def("VICTIM", 1, 4), bonus: 0 }]);
    const before = {
      power: state.destroyedPower,
      count: state.destroyedCount,
    };
    const { state: after, events } = endTurn(state, mulberry32(1));
    expect(after.players.top.deck.length).toBe(0);
    expect(after.destroyedPower).toBe(before.power + 4);
    expect(after.destroyedCount).toBe(before.count + 1);
    expect(abilityTexts(events).some((t) => t.includes("VICTIM"))).toBe(true);
  });

  it("empty enemy deck → no-op", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const killing = instance(def("KIL", 2, 5, killingDeck()), "bottom");
    setLane(state, 0, [null, null, killing]);
    setDeck(state, "top", []);
    const before = state.destroyedCount;
    const { state: after } = endTurn(state, mulberry32(1));
    expect(after.destroyedCount).toBe(before);
  });
});

// =============================================================================
// Numb Eyes (numbDeck)
// =============================================================================
describe("Numb Eyes / numbDeck", () => {
  it("destroys a random card in the owner's own deck, feeds Stella, and logs its name", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const numb = instance(def("NMB", 3, 11, numbDeck()), "bottom");
    setLane(state, 0, [null, null, numb]);
    setDeck(state, "bottom", [{ def: def("MINE", 1, 6), bonus: 0 }]);
    const before = {
      power: state.destroyedPower,
      count: state.destroyedCount,
    };
    const { state: after, events } = endTurn(state, mulberry32(1));
    expect(after.players.bottom.deck.length).toBe(0);
    expect(after.destroyedPower).toBe(before.power + 6);
    expect(after.destroyedCount).toBe(before.count + 1);
    expect(abilityTexts(events).some((t) => t.includes("MINE"))).toBe(true);
  });

  it("empty deck → no-op", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const numb = instance(def("NMB", 3, 11, numbDeck()), "bottom");
    setLane(state, 0, [null, null, numb]);
    setDeck(state, "bottom", []);
    const before = state.destroyedCount;
    const { state: after } = endTurn(state, mulberry32(1));
    expect(after.destroyedCount).toBe(before);
  });
});

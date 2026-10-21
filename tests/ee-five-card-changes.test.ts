import { describe, expect, it } from "vitest";
import {
  canPlay,
  endTurn,
  instanceCost,
  legalPlays,
} from "../src/engine/rules";
import type {
  Ability,
  CardDef,
  CardInstance,
  GameState,
  Seat,
} from "../src/engine/types";
import { mulberry32 } from "../src/util/rng";
import {
  def,
  deckOf,
  emptyGame,
  give,
  instance,
  setLane,
} from "./engine-helpers";

// --- Ability constructors (mirror the shorthand tokens in cards.json) --------
const soulfireGate = (): Ability => ({
  timing: "continuous",
  effect: { kind: "soulfireGate" },
});
const trackingDraw = (): Ability => ({
  timing: "continuous",
  effect: { kind: "trackingDraw" },
});
const gentleDeckDiscount = (): Ability => ({
  timing: "continuous",
  effect: { kind: "gentleDeckDiscount" },
});
const slyLower = (): Ability => ({
  timing: "active",
  effect: { kind: "slyLower" },
});
const wiseHandPower = (): Ability => ({
  timing: "active",
  effect: { kind: "wiseHandPower" },
});

const onBoard = (state: GameState): CardInstance[] =>
  state.lanes.flat().filter((c): c is CardInstance => c !== null);

// emptyGame starts 50/50 (total 100, balance = bottom's HP = 50). Set bottom's HP directly.
const setBottomHP = (state: GameState, hp: number) => {
  state.balance = hp;
};

// =============================================================================
// Soulfire Eyes (soulfireGate) — play gate, modeled on vaingloryGate
// =============================================================================
describe("Soulfire Eyes / soulfireGate", () => {
  it("is blocked when the meter is even or in the owner's favor", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const soul = give(state, "bottom", def("SOUL", 2, 7, soulfireGate()));
    state.players.bottom.energy = 5;
    setBottomHP(state, 50); // even → blocked
    expect(canPlay(state, soul.uid, 0)).toEqual({
      ok: false,
      reason: "blocked",
    });
    setBottomHP(state, 70); // owner ahead → blocked
    expect(canPlay(state, soul.uid, 0)).toEqual({
      ok: false,
      reason: "blocked",
    });
  });

  it("is playable only while the owner is losing (owner HP < enemy HP)", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const soul = give(state, "bottom", def("SOUL", 2, 7, soulfireGate()));
    state.players.bottom.energy = 5;
    setBottomHP(state, 30); // bottom 30 < top 70 → playable
    expect(canPlay(state, soul.uid, 0).ok).toBe(true);
  });

  it("is hidden from legalPlays when gated", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const soul = give(state, "bottom", def("SOUL", 2, 7, soulfireGate()));
    state.players.bottom.energy = 5;
    setBottomHP(state, 50);
    expect(legalPlays(state).some((p) => p.uid === soul.uid)).toBe(false);
    setBottomHP(state, 30);
    expect(legalPlays(state).some((p) => p.uid === soul.uid)).toBe(true);
  });

  it("reads from the top seat's perspective too", () => {
    const state = emptyGame("top");
    state.active = "top";
    const soul = give(state, "top", def("SOUL", 2, 7, soulfireGate()));
    state.players.top.energy = 5;
    // top HP = total - balance. balance 70 → top HP 30 < bottom 70 → playable.
    state.balance = 70;
    expect(canPlay(state, soul.uid, 0).ok).toBe(true);
    // balance 30 → top HP 70 > bottom 30 → blocked.
    state.balance = 30;
    expect(canPlay(state, soul.uid, 0)).toEqual({
      ok: false,
      reason: "blocked",
    });
  });
});

// =============================================================================
// Tracking Eyes (trackingDraw) — draw 1 at end of turn while losing
// =============================================================================
describe("Tracking Eyes / trackingDraw", () => {
  it("draws 1 at the owner's end of turn when losing (bottom)", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const track = instance(def("TRACK", 3, 1, trackingDraw()), "bottom");
    setLane(state, 0, [null, null, track]);
    state.players.bottom.deck = deckOf([def("d0", 1, 1), def("d1", 1, 1)]);
    setBottomHP(state, 30); // bottom losing (30 < 70)
    const before = state.players.bottom.hand.length;
    const { state: after } = endTurn(state, mulberry32(1));
    // Tracking's own draw (+1) is the only end-of-turn draw here; startTurn draws for TOP next,
    // so bottom's hand reflects just Tracking's draw.
    expect(after.players.bottom.hand.length).toBe(before + 1);
  });

  it("does not draw when the owner is even or ahead", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const track = instance(def("TRACK", 3, 1, trackingDraw()), "bottom");
    setLane(state, 0, [null, null, track]);
    state.players.bottom.deck = deckOf([def("d0", 1, 1)]);
    setBottomHP(state, 50); // even → no draw
    const before = state.players.bottom.hand.length;
    const { state: after } = endTurn(state, mulberry32(1));
    expect(after.players.bottom.hand.length).toBe(before);
    expect(after.players.bottom.deck.length).toBe(1);
  });

  it("works from the top seat's perspective (top draws when losing)", () => {
    const state = emptyGame("top");
    state.active = "top";
    const track = instance(def("TRACK", 3, 1, trackingDraw()), "top");
    setLane(state, 0, [track, null, null]);
    state.players.top.deck = deckOf([def("d0", 1, 1), def("d1", 1, 1)]);
    // top HP = total - balance; balance 70 → top HP 30 < bottom 70 → top losing.
    state.balance = 70;
    const before = state.players.top.hand.length;
    const { state: after } = endTurn(state, mulberry32(1));
    expect(after.players.top.hand.length).toBe(before + 1);
  });

  it("empty deck → no crash, no draw", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const track = instance(def("TRACK", 3, 1, trackingDraw()), "bottom");
    setLane(state, 0, [null, null, track]);
    state.players.bottom.deck = [];
    setBottomHP(state, 30);
    const before = state.players.bottom.hand.length;
    const { state: after } = endTurn(state, mulberry32(1));
    expect(after.players.bottom.hand.length).toBe(before);
  });
});

// =============================================================================
// Gentle Eyes (gentleDeckDiscount) — discount a random deck card while losing
// =============================================================================
describe("Gentle Eyes / gentleDeckDiscount", () => {
  it("reduces one random deck card's cost by 1 when losing, and it carries onto the drawn instance", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const gentle = instance(
      def("GENTLE", 2, 2, gentleDeckDiscount()),
      "bottom",
    );
    setLane(state, 0, [null, null, gentle]);
    // Single-card deck so the picked entry is unambiguous.
    state.players.bottom.deck = deckOf([def("d0", 5, 1)]);
    setBottomHP(state, 30); // losing
    const a = endTurn(state, mulberry32(7));
    const entry = a.state.players.bottom.deck[0];
    expect(entry.costReduction).toBe(1);

    // Now let TOP end its turn: startTurn runs for BOTTOM and draws the discounted entry, which must
    // carry the reduction onto the hand CardInstance (proves the draw() threading).
    a.state.active = "top";
    const b = endTurn(a.state, mulberry32(1));
    const drawn = b.state.players.bottom.hand.find((c) => c.def.id === "d0")!;
    expect(drawn.costReduction).toBe(1);
    expect(instanceCost(b.state, "bottom", drawn)).toBe(4); // base 5 − 1
  });

  it("accumulates over two losing turns", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const gentle = instance(
      def("GENTLE", 2, 2, gentleDeckDiscount()),
      "bottom",
    );
    setLane(state, 0, [null, null, gentle]);
    // Single-card deck so the same entry is always picked.
    state.players.bottom.deck = deckOf([def("d0", 5, 1)]);
    setBottomHP(state, 30);
    const a = endTurn(state, mulberry32(3));
    expect(a.state.players.bottom.deck[0].costReduction).toBe(1);
    // Keep bottom active and losing for a second resolution.
    a.state.active = "bottom";
    a.state.balance = 30;
    const b = endTurn(a.state, mulberry32(3));
    expect(b.state.players.bottom.deck[0].costReduction).toBe(2);
  });

  it("does nothing when even/ahead or when the deck is empty", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const gentle = instance(
      def("GENTLE", 2, 2, gentleDeckDiscount()),
      "bottom",
    );
    setLane(state, 0, [null, null, gentle]);
    state.players.bottom.deck = deckOf([def("d0", 5, 1)]);
    setBottomHP(state, 50); // even → no change
    const a = endTurn(state, mulberry32(1));
    expect(a.state.players.bottom.deck[0].costReduction ?? 0).toBe(0);

    // Empty deck while losing → no crash, nothing to discount.
    state.players.bottom.deck = [];
    setBottomHP(state, 30);
    state.active = "bottom";
    const b = endTurn(state, mulberry32(1));
    expect(b.state.players.bottom.deck.length).toBe(0);
  });

  it("works from the top seat's perspective", () => {
    const state = emptyGame("top");
    state.active = "top";
    const gentle = instance(def("GENTLE", 2, 2, gentleDeckDiscount()), "top");
    setLane(state, 0, [gentle, null, null]);
    state.players.top.deck = deckOf([def("d0", 5, 1)]);
    state.balance = 70; // top losing
    const { state: after } = endTurn(state, mulberry32(1));
    expect(after.players.top.deck[0].costReduction).toBe(1);
  });
});

// =============================================================================
// Sly Eyes (slyLower) — self-pull the meter 10 toward the owner at end of turn
// =============================================================================
describe("Sly Eyes / slyLower", () => {
  it("lowers bottom's balance by 10 and emits a tide_shifted with rawDelta -10", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const sly = instance(def("SLY", 4, 14, slyLower()), "bottom");
    // A matching enemy body so the board-power tide shift this turn is 0.
    setLane(state, 0, [instance(def("E", 4, 14), "top"), null, sly]);
    setBottomHP(state, 50);
    const { state: after, events } = endTurn(state, mulberry32(1));
    expect(after.balance).toBe(40); // 50 − 10
    const slyShift = events.find(
      (e) => e.type === "tide_shifted" && e.rawDelta === -10,
    );
    expect(slyShift).toBeDefined();
  });

  it("raises top's balance by 10 (rawDelta +10) from the top seat's perspective", () => {
    const state = emptyGame("top");
    state.active = "top";
    const sly = instance(def("SLY", 4, 14, slyLower()), "top");
    setLane(state, 0, [sly, null, instance(def("E", 4, 14), "bottom")]);
    setBottomHP(state, 50);
    const { state: after, events } = endTurn(state, mulberry32(1));
    expect(after.balance).toBe(60); // 50 + 10
    const slyShift = events.find(
      (e) => e.type === "tide_shifted" && e.rawDelta === 10,
    );
    expect(slyShift).toBeDefined();
  });

  it("pulling a bottom owner's own HP to 0 loses the game for bottom (top wins)", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const sly = instance(def("SLY", 4, 14, slyLower()), "bottom");
    setLane(state, 0, [instance(def("E", 4, 14), "top"), null, sly]);
    setBottomHP(state, 5); // 5 − 10 clamps to 0 → bottom's own edge → bottom loses
    const { state: after } = endTurn(state, mulberry32(1));
    expect(after.balance).toBe(0);
    expect(after.winner).toBe("top");
  });

  it("pulling a top owner's own HP to 0 loses the game for top (bottom wins)", () => {
    const state = emptyGame("top");
    state.active = "top";
    const sly = instance(def("SLY", 4, 14, slyLower()), "top");
    setLane(state, 0, [sly, null, instance(def("E", 4, 14), "bottom")]);
    setBottomHP(state, 95); // top HP 5; +10 → balance 100 → top's own edge → top loses
    const { state: after } = endTurn(state, mulberry32(1));
    expect(after.balance).toBe(100);
    expect(after.winner).toBe("bottom");
  });
});

// =============================================================================
// Wise Eyes (wiseHandPower) — gain 2 power per card in hand at end of turn
// =============================================================================
describe("Wise Eyes / wiseHandPower", () => {
  it("gains 2 power per card remaining in the owner's hand", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const wise = instance(def("WISE", 4, 2, wiseHandPower()), "bottom");
    setLane(state, 0, [null, null, wise]);
    state.players.bottom.hand = [
      instance(def("h0", 1, 1), "bottom"),
      instance(def("h1", 1, 1), "bottom"),
      instance(def("h2", 1, 1), "bottom"),
    ];
    const { state: after } = endTurn(state, mulberry32(1));
    const liveWise = onBoard(after).find((c) => c.uid === wise.uid)!;
    // Hand had 3 cards at resolution time → +6. (startTurn then draws for TOP, not bottom.)
    expect(liveWise.bonus).toBe(6);
  });

  it("gains 0 with an empty hand", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const wise = instance(def("WISE", 4, 2, wiseHandPower()), "bottom");
    setLane(state, 0, [null, null, wise]);
    state.players.bottom.hand = [];
    const { state: after } = endTurn(state, mulberry32(1));
    const liveWise = onBoard(after).find((c) => c.uid === wise.uid)!;
    expect(liveWise.bonus).toBe(0);
  });

  it("works from the top seat's perspective (reads top's hand)", () => {
    const state = emptyGame("top");
    state.active = "top";
    const wise = instance(def("WISE", 4, 2, wiseHandPower()), "top");
    setLane(state, 0, [wise, null, null]);
    state.players.top.hand = [
      instance(def("h0", 1, 1), "top"),
      instance(def("h1", 1, 1), "top"),
    ];
    const { state: after } = endTurn(state, mulberry32(1));
    const liveWise = onBoard(after).find((c) => c.uid === wise.uid)!;
    expect(liveWise.bonus).toBe(4); // 2 cards × 2
  });
});

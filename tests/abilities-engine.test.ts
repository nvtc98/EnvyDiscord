import { describe, expect, it } from "vitest";
import {
  canPlay,
  effectivePower,
  endTurn,
  instanceCost,
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
import {
  deckOf,
  def,
  emptyGame,
  give,
  instance,
  setLane,
} from "./engine-helpers";

// Ability constructors for the seven designed cards (mirrors their shorthand in cards.json).
const stella = (): Ability => ({
  timing: "active",
  effect: { kind: "stellaPush" },
});
const astral = (): Ability => ({
  timing: "active",
  effect: { kind: "astralDiscount" },
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
  // A lone power-0 Stella keeps board power 0 on both sides, so resolveTurn's own tide shift is 0 and
  // Stella's end-of-turn EP push is the only thing that moves the meter.
  const runStella = (
    owner: "bottom" | "top",
    balance: number,
    tally: number,
  ) => {
    const state = emptyGame(owner);
    state.active = owner;
    state.balance = balance; // total HP is 100 (50 + 50 default)
    state.destroyedPower = tally;
    const stellaCard = instance(def("STELLA", 5, 0, stella()), owner);
    setLane(state, 0, [
      owner === "bottom" ? null : stellaCard,
      null,
      owner === "bottom" ? stellaCard : null,
    ]);
    return { stellaCard, step: endTurn(state, mulberry32(1)) };
  };

  // resolveTurn always emits one baseline tide_shifted (rawDelta 0 here, since board power is 0 on
  // both sides); Stella's end-of-turn push emits a SECOND one. Grab the last tide_shifted = Stella's.
  const lastShift = (step: ReturnType<typeof endTurn>) =>
    [...step.events].reverse().find((e) => e.type === "tide_shifted");

  it("pushes The Eyes Privilege toward the enemy by the destroyed-power tally (bottom owner)", () => {
    const { step } = runStella("bottom", 50, 11);
    // Bottom owner pushes toward the enemy = balance up by the tally.
    expect(step.state.balance).toBe(61);
    expect(lastShift(step)).toMatchObject({
      rawDelta: 11,
      delta: 11,
      balance: 61,
    });
  });

  it("is seat-correct for a top owner (balance drops by the tally)", () => {
    const { step } = runStella("top", 50, 11);
    expect(step.state.balance).toBe(39);
    expect(lastShift(step)).toMatchObject({
      rawDelta: -11,
      delta: -11,
      balance: 39,
    });
  });

  it("clamps at the edge and wins when the push reaches the top of the meter", () => {
    const { step } = runStella("bottom", 95, 40); // 95 + 40 clamps to 100
    expect(step.state.balance).toBe(100);
    expect(step.state.winner).toBe("bottom");
    expect(
      step.events.some((e) => e.type === "game_over" && e.winner === "bottom"),
    ).toBe(true);
  });

  it("does nothing when nothing has been destroyed this match", () => {
    const { step } = runStella("bottom", 50, 0);
    expect(step.state.balance).toBe(50);
    // Only the baseline resolveTurn tide_shifted (rawDelta 0) fires — Stella adds no second shift.
    const shifts = step.events.filter((e) => e.type === "tide_shifted");
    expect(shifts).toHaveLength(1);
    expect(shifts[0]).toMatchObject({ rawDelta: 0 });
  });
});

describe("Astral Eyes", () => {
  it("reduces every current hand card's cost by 1 at end of turn, leaving board and later draws alone", () => {
    const state = emptyGame("bottom");
    state.active = "bottom";
    const astralCard = instance(def("ASTRAL", 5, 7, astral()), "bottom");
    setLane(state, 0, [null, null, astralCard]);
    // Current hand: a 3-cost and a 0-cost card (0-cost floors at 0, not negative).
    const h3 = give(state, "bottom", def("H3", 3, 1));
    const h0 = give(state, "bottom", def("H0", 0, 1));
    // A board card's cost must be unaffected by the hand discount.
    const boardCard = instance(def("ONBOARD", 4, 1), "bottom");
    setLane(state, 1, [null, null, boardCard]);
    const { state: after } = endTurn(state, mulberry32(1));
    const hand = after.players.bottom.hand;
    const a3 = hand.find((c) => c.def.id === "H3")!;
    const a0 = hand.find((c) => c.def.id === "H0")!;
    expect(a3.costReduction).toBe(1);
    expect(instanceCost(after, "bottom", a3)).toBe(2); // 3 - 1
    expect(a0.costReduction).toBe(1);
    expect(instanceCost(after, "bottom", a0)).toBe(0); // 0 - 1 floors at 0
    // The board card carries no in-hand discount.
    const boardAfter = after.lanes[1].find((c) => c?.def.id === "ONBOARD")!;
    expect(boardAfter.costReduction).toBeUndefined();
    // A card drawn afterward (opponent's turn drew into bottom? no — only bottom's hand snapshot was
    // discounted) has no costReduction. The two originally-held uids are the only discounted ones.
    const touched = hand
      .filter((c) => (c.costReduction ?? 0) > 0)
      .map((c) => c.uid);
    expect(touched.sort()).toEqual([h3.uid, h0.uid].sort());
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

describe("Ocean Eyes end-of-turn deck buff + return", () => {
  const setupOcean = (first: "bottom" | "top" = "bottom") => {
    const state = emptyGame(first);
    state.players.bottom.deck = deckOf([def("D0", 1, 1), def("D1", 1, 1)]);
    return state;
  };

  it("buffs every remaining deck card +1 and returns itself to the deck with its own accumulated bonus", () => {
    const state = setupOcean();
    // Resolve on top's turn (first = top). The Ocean pass runs for every on-board Ocean regardless of
    // whose turn it is, so a bottom-owned Ocean still returns and buffs bottom's deck. After top's turn
    // bottom's startTurn draws one card, so a buffed card may be in hand — check deck+hand together.
    state.first = "top";
    state.active = "top";
    setLane(state, 0, [
      null,
      null,
      instance(def("OCE", 1, 2, ocean()), "bottom"),
    ]);
    const after = endTurn(state, mulberry32(0)).state;
    // Ocean left the board.
    expect(onBoard(after).some((c) => c.def.id === "OCE")).toBe(false);
    // The bonus a card now carries, whether it sits in the deck (DeckCard.bonus) or was drawn (CardInstance.bonus).
    const bonusOf = (id: string): number => {
      const inDeck = after.players.bottom.deck.find((d) => d.def.id === id);
      if (inDeck) return inDeck.bonus;
      const inHand = after.players.bottom.hand.find((c) => c.def.id === id);
      return inHand ? inHand.bonus : NaN;
    };
    // The two original deck cards each got +1.
    expect(bonusOf("D0")).toBe(1);
    expect(bonusOf("D1")).toBe(1);
    // Ocean is back in the library carrying +1 (board bonus 0, grown by +1 "including itself").
    expect(bonusOf("OCE")).toBe(1);
  });

  it("a drawn buffed deck card becomes a hand card whose power reflects the accumulated bonus", () => {
    const state = setupOcean();
    setLane(state, 0, [
      null,
      null,
      instance(def("OCE", 1, 2, ocean()), "bottom"),
    ]);
    // bottom ends its turn (buffs the deck), then top's turn, then bottom's startTurn draws a card.
    const after = endTurn(
      endTurn(state, mulberry32(0)).state,
      mulberry32(0),
    ).state;
    // Every card now in bottom's hand or deck that came from the buffed deck carries bonus 1 (OCE
    // carries its +1 too). A freshly drawn buffed card keeps that bonus in hand.
    const drawn = after.players.bottom.hand.filter(
      (c) => c.def.id === "D0" || c.def.id === "D1" || c.def.id === "OCE",
    );
    for (const c of drawn) expect(c.bonus).toBe(1);
    // And whatever remains in the deck still carries +1.
    for (const entry of after.players.bottom.deck)
      if (["D0", "D1", "OCE"].includes(entry.def.id))
        expect(entry.bonus).toBe(1);
  });

  it("two Oceans in one end-of-turn each buff the deck, stacking the bonus (+2 total)", () => {
    // Resolve on top's turn so both bottom-owned Oceans resolve before bottom draws. A deep deck keeps
    // the sampled card in the deck after the single post-turn draw.
    const state = emptyGame("top");
    state.active = "top";
    state.players.bottom.deck = deckOf([
      def("D0", 1, 1),
      def("D1", 1, 1),
      def("D2", 1, 1),
      def("D3", 1, 1),
      def("D4", 1, 1),
    ]);
    setLane(state, 0, [
      null,
      instance(def("O1", 1, 2, ocean()), "bottom"),
      instance(def("O2", 1, 2, ocean()), "bottom"),
    ]);
    const after = endTurn(state, mulberry32(0)).state;
    const bonusOf = (id: string): number => {
      const inDeck = after.players.bottom.deck.find((d) => d.def.id === id);
      if (inDeck) return inDeck.bonus;
      const inHand = after.players.bottom.hand.find((c) => c.def.id === id);
      return inHand ? inHand.bonus : NaN;
    };
    // Each Ocean pass buffs the deck +1, so every original deck card ends at +2.
    for (const id of ["D0", "D1", "D2", "D3", "D4"])
      expect(bonusOf(id)).toBe(2);
  });

  it("inserts at a deterministic seeded position", () => {
    const build = () => {
      const s = setupOcean();
      s.first = "top";
      s.active = "top";
      setLane(s, 0, [
        null,
        null,
        instance(def("OCE", 1, 2, ocean()), "bottom"),
      ]);
      return s;
    };
    const resolve = (seed: number) =>
      endTurn(build(), mulberry32(seed)).state.players.bottom.deck.map(
        (d) => d.def.id,
      );
    // Same seed -> identical deck ordering (including Ocean's inserted slot).
    expect(resolve(42)).toEqual(resolve(42));
  });

  it("buffs only the owner's deck and never touches the enemy deck", () => {
    const state = setupOcean();
    // Give the enemy (top) a deck of its own; a bottom-owned Ocean must leave it untouched.
    state.players.top.deck = deckOf([def("T0", 1, 1), def("T1", 1, 1)]);
    state.first = "top";
    state.active = "top";
    setLane(state, 0, [
      null,
      null,
      instance(def("OCE", 1, 2, ocean()), "bottom"),
    ]);
    const after = endTurn(state, mulberry32(0)).state;
    // Every enemy deck entry still carries bonus 0 — the Ocean pass only ever reads bottom's deck.
    for (const entry of after.players.top.deck) expect(entry.bonus).toBe(0);
    // And the enemy deck still holds exactly its two original cards (nothing inserted/removed).
    expect(after.players.top.deck.map((d) => d.def.id).sort()).toEqual([
      "T0",
      "T1",
    ]);
  });

  it("handles the empty-deck case (Ocean becomes the only deck card at +1, then is drawn next turn)", () => {
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
      ...after.players.bottom.deck.map((d) => d.def.id),
      ...after.players.bottom.hand.map((c) => c.def.id),
    ];
    expect(library).toEqual(["OCE"]);
    // It carries its +1 "including itself" buff wherever it now sits.
    const drawn = after.players.bottom.hand.find((c) => c.def.id === "OCE");
    if (drawn) expect(drawn.bonus).toBe(1);
    const inDeck = after.players.bottom.deck.find((d) => d.def.id === "OCE");
    if (inDeck) expect(inDeck.bonus).toBe(1);
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

  it("does NOT push itself: Siren stays at its own cell while other cards shift", () => {
    const state = emptyGame("bottom");
    // bottom near edge = cell 2, far edge = cell 0. An ally sits at cell 1; Siren enters at cell 2.
    setLane(state, 0, [null, instance(def("ALLY", 1, 3), "bottom"), null]);
    const after = play(state, "bottom", def("SIREN", 4, 2, siren()), 0);
    const ally = after.lanes[0].findIndex((c) => c?.def.id === "ALLY");
    const siren_ = after.lanes[0].findIndex((c) => c?.def.id === "SIREN");
    // The ally is shoved one step toward the far edge (cell 1 -> cell 0); Siren stays at cell 2.
    expect(ally).toBe(0);
    expect(siren_).toBe(2);
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

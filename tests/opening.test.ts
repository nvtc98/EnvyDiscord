import { describe, expect, it } from "vitest";
import { NPC_INDEX, npcDeck } from "../src/data/npcs";
import { COLLECTIBLE_CARDS } from "../src/data/cards";
import { seedGuaranteedOpening } from "../src/engine/opening";
import { newGame } from "../src/engine/rules";
import type { CardDef, GameState, Seat } from "../src/engine/types";
import { mulberry32 } from "../src/util/rng";

const boSpdDeck = (): CardDef[] => npcDeck(NPC_INDEX.get("bo-spd")!);
/** A plain 12-card player deck of distinct collectible cards (contents are irrelevant to these tests). */
const playerDeck = (): CardDef[] => COLLECTIBLE_CARDS.slice(0, 12);

/** All uids across a seat's hand + deck instances (deck holds CardDefs, so uids come from the hand only). */
const handIds = (state: GameState, seat: Seat): string[] =>
  state.players[seat].hand.map((c) => c.def.id);

/** Count of a given card id across hand + deck for a seat (the 12-card multiset). */
const multiset = (state: GameState, seat: Seat, id: string): number =>
  handIds(state, seat).filter((x) => x === id).length +
  state.players[seat].deck.filter((d) => d.id === id).length;

describe("seedGuaranteedOpening holds the guaranteed card deterministically", () => {
  it.each<Seat>(["top", "bottom"])(
    "puts bo-sieu-phan-ong-cap-1 into the top hand when first=%s",
    (first) => {
      const { state } = newGame(
        { bottom: playerDeck(), top: boSpdDeck() },
        first,
        mulberry32(7),
      );
      const handBefore = state.players.top.hand.length;
      seedGuaranteedOpening(state, "top", ["bo-sieu-phan-ong-cap-1"]);

      // Exactly one cap-1 in hand, hand size unchanged.
      expect(
        handIds(state, "top").filter((id) => id === "bo-sieu-phan-ong-cap-1"),
      ).toHaveLength(1);
      expect(state.players.top.hand).toHaveLength(handBefore);

      // The 12-card multiset is intact: 1 cap-1 + 11 bo-tuoi across hand + deck.
      expect(multiset(state, "top", "bo-sieu-phan-ong-cap-1")).toBe(1);
      expect(multiset(state, "top", "bo-tuoi")).toBe(11);
      expect(
        state.players.top.hand.length + state.players.top.deck.length,
      ).toBe(12);

      // All hand uids are unique.
      const uids = state.players.top.hand.map((c) => c.uid);
      expect(new Set(uids).size).toBe(uids.length);
    },
  );

  it("is idempotent: a second call is a no-op", () => {
    const { state } = newGame(
      { bottom: playerDeck(), top: boSpdDeck() },
      "bottom",
      mulberry32(7),
    );
    seedGuaranteedOpening(state, "top", ["bo-sieu-phan-ong-cap-1"]);
    const handAfterFirst = state.players.top.hand.map((c) => c.uid);
    seedGuaranteedOpening(state, "top", ["bo-sieu-phan-ong-cap-1"]);
    expect(state.players.top.hand.map((c) => c.uid)).toEqual(handAfterFirst);
    expect(
      handIds(state, "top").filter((id) => id === "bo-sieu-phan-ong-cap-1"),
    ).toHaveLength(1);
  });

  it("throws when a guaranteed id is not in the seat's deck", () => {
    const { state } = newGame(
      { bottom: playerDeck(), top: boSpdDeck() },
      "bottom",
      mulberry32(7),
    );
    expect(() =>
      seedGuaranteedOpening(state, "top", ["venom-eyes"]),
    ).toThrow(/"venom-eyes" not found in top deck/);
  });

  it("throws when guaranteed count exceeds the opening hand size", () => {
    const { state } = newGame(
      { bottom: playerDeck(), top: boSpdDeck() },
      "top", // top goes first -> top opening hand of 2 before its startTurn draw... use a crafted state
      mulberry32(7),
    );
    // Craft: ask for more guaranteed cards than the hand holds.
    const tooMany = Array(state.players.top.hand.length + 1).fill(
      "bo-sieu-phan-ong-cap-1",
    );
    expect(() => seedGuaranteedOpening(state, "top", tooMany)).toThrow(
      /guaranteed cards exceed top opening hand/,
    );
  });
});

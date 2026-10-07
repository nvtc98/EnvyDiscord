import type { CardInstance, GameState, Seat } from "./types";

/**
 * Ensure each id in `guaranteed` is present in `seat`'s opening hand, WITHOUT changing the hand size
 * or the deck's card multiset. Pure, deterministic (consumes no rng), HOLD-only (never forces a play):
 * it touches only `hand`/`deck`, so whether the AI then PLAYS the guaranteed card is ordinary turn
 * logic, untouched here.
 *
 * For each guaranteed id not already in hand: find an instance of that def still in the seat's draw
 * pile, evict a non-guaranteed hand card (pushed to the FRONT of the deck so it is the next natural
 * draw), remove the guaranteed def from the deck, and add it to the hand as a fresh CardInstance with
 * a new uid. No-op for ids already in hand; idempotent given the same inputs. Mutates `state` in place.
 */
export function seedGuaranteedOpening(
  state: GameState,
  seat: Seat,
  guaranteed: readonly string[],
): void {
  const player = state.players[seat];
  const handSize = player.hand.length;
  if (guaranteed.length > handSize)
    throw new Error(
      `seedGuaranteedOpening: ${guaranteed.length} guaranteed cards exceed ${seat} opening hand of ${handSize}`,
    );
  const guaranteedSet = new Set(guaranteed);

  for (const id of guaranteed) {
    if (player.hand.some((c) => c.def.id === id)) continue; // already guaranteed

    const deckIndex = player.deck.findIndex((def) => def.id === id);
    if (deckIndex < 0)
      throw new Error(
        `seedGuaranteedOpening: "${id}" not found in ${seat} deck`,
      );

    const evictIndex = player.hand.findIndex(
      (c) => !guaranteedSet.has(c.def.id),
    );
    if (evictIndex < 0)
      // Unreachable given the hand-size guard above, but fail loud rather than silently add a 13th card.
      throw new Error(
        `seedGuaranteedOpening: no evictable hand card for "${id}" in ${seat} hand`,
      );

    const [evicted] = player.hand.splice(evictIndex, 1);
    const [guaranteedDef] = player.deck.splice(deckIndex, 1);
    player.deck.unshift(evicted.def); // keep the 12-card multiset; it is the next natural draw
    const instance: CardInstance = {
      uid: state.nextUid++,
      def: guaranteedDef,
      owner: seat,
      bonus: 0,
    };
    player.hand.push(instance);
  }
}

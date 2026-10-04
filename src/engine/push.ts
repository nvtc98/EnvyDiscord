import { CELLS, type Cell, type CardInstance, type Seat } from './types';

/** The cell a seat enters a lane at: the bottom player at the bottom edge, the top player at the top edge. */
export const entryCell = (seat: Seat): number => (seat === 'bottom' ? CELLS - 1 : 0);

export interface PushResult {
  lane: Cell[];
  /** The card pushed off the far edge, if the push chain reached it. */
  destroyed: CardInstance | null;
}

/**
 * Inserts `card` at the seat's edge of the lane. An occupied entry cell pushes its card one step toward the
 * far edge, which may push the next one, and so on. The chain stops at the first empty cell, so a gap absorbs
 * the push. If the chain runs off the board, the card at the far edge is destroyed.
 * Does not modify `lane`.
 */
export function pushInto(lane: readonly Cell[], card: CardInstance, seat: Seat): PushResult {
  const next = [...lane];
  const step = seat === 'bottom' ? -1 : 1;
  let carried: CardInstance = card;
  let i = entryCell(seat);
  for (;;) {
    const occupant = next[i];
    next[i] = carried;
    if (!occupant) return { lane: next, destroyed: null };
    carried = occupant;
    i += step;
    if (i < 0 || i >= CELLS) return { lane: next, destroyed: carried };
  }
}

/** A push is needed when the entry cell is already taken. */
export const wouldPush = (lane: readonly Cell[], seat: Seat): boolean => lane[entryCell(seat)] !== null;

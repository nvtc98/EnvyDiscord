import { CARDS } from "../src/data/cards";
import { newGame } from "../src/engine/rules";
import { DECK_SIZE } from "../src/engine/types";
import type {
  Ability,
  CardDef,
  CardInstance,
  Cell,
  DeckCard,
  GameState,
  LaneIndex,
  Seat,
} from "../src/engine/types";
import { mulberry32 } from "../src/util/rng";

export const def = (
  id: string,
  cost: number,
  power: number,
  ability?: Ability,
): CardDef => ({ id, name: id.toUpperCase(), cost, power, ability });

/** A full-size deck of plain cards, so tests that do not care about the deck can ignore it. */
export const plainDeck = (): CardDef[] =>
  Array.from({ length: DECK_SIZE }, (_, i) => def(`p${i}`, 1, 1));
export const realDeck = (): CardDef[] => CARDS.slice(0, DECK_SIZE);

/** A started game with empty hands and boards, so tests can place exactly what they need. */
export function emptyGame(
  first: Seat = "bottom",
  deck: CardDef[] = plainDeck(),
): GameState {
  const { state } = newGame({ bottom: deck, top: deck }, first, mulberry32(1));
  const clean = structuredClone(state);
  clean.players.bottom.hand = [];
  clean.players.top.hand = [];
  return clean;
}

let uid = 1000;
export function instance(card: CardDef, owner: Seat, bonus = 0): CardInstance {
  return { uid: uid++, def: card, owner, bonus };
}

/** Wrap raw card defs into deck entries (bonus 0) for assigning to a PlayerState.deck in tests. */
export const deckOf = (defs: readonly CardDef[]): DeckCard[] =>
  defs.map((def) => ({ def, bonus: 0 }));

export function give(
  state: GameState,
  seat: Seat,
  card: CardDef,
): CardInstance {
  const c = instance(card, seat);
  state.players[seat].hand.push(c);
  return c;
}

/** Sets a lane from top to bottom, e.g. `setLane(state, 0, [e1, null, p1])`. */
export function setLane(
  state: GameState,
  lane: LaneIndex,
  cells: Cell[],
): void {
  state.lanes[lane] = cells;
}

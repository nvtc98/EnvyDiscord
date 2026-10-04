/** Rules constants. See docs/superpowers/specs/2026-10-04-lane-battle-design.md. */
export const LANES = 3;
export const CELLS = 3;
export const MAX_HP = 20;
export const MAX_ENERGY = 9;
export const MAX_ROUNDS = 30;
export const DECK_SIZE = 12;
/** Cards drawn before the first turn; every turn then starts with one more draw. */
export const OPENING_HAND = { first: 2, second: 3 } as const;

/** Where a player sits. `bottom` is the human at the bottom of the board, `top` is the opponent. */
export type Seat = 'bottom' | 'top';
export type LaneIndex = 0 | 1 | 2;

export type ActiveEffect =
  | { kind: 'heal'; amount: number }
  | { kind: 'damage'; amount: number }
  | { kind: 'draw'; count: number }
  | { kind: 'energy'; amount: number }
  | { kind: 'buffLane'; amount: number };
export type ContinuousEffect = { kind: 'laneDouble' } | { kind: 'anchor' };
export type EndOfRoundEffect = { kind: 'heal'; amount: number };

/** Active: once, when the card is played. Passive: while on the board, either always or at the end of each round. */
export type Ability =
  | { timing: 'active'; effect: ActiveEffect }
  | { timing: 'continuous'; effect: ContinuousEffect }
  | { timing: 'endOfRound'; effect: EndOfRoundEffect };

export interface CardDef {
  id: string;
  name: string;
  cost: number;
  power: number;
  ability?: Ability;
  /** Rules text shown on the card. Defaults to a description generated from the ability. */
  text?: string;
}

export interface CardInstance {
  /** Unique within one game; identifies a card in hand or on the board. */
  uid: number;
  def: CardDef;
  owner: Seat;
  /** Permanent power changes from abilities. */
  bonus: number;
}

export interface PlayerState {
  hp: number;
  energy: number;
  /** Turns this player has started, counting the current one. */
  turns: number;
  /** Remaining cards, next draw first. */
  deck: CardDef[];
  hand: CardInstance[];
}

export type Cell = CardInstance | null;

export interface GameState {
  /** `lanes[lane][cell]`; cell 0 is the top edge, cell 2 the bottom edge. */
  lanes: Cell[][];
  players: Record<Seat, PlayerState>;
  first: Seat;
  active: Seat;
  round: number;
  winner: Seat | 'draw' | null;
  nextUid: number;
}

export interface Play {
  uid: number;
  lane: LaneIndex;
}

export type GameEvent =
  | { type: 'drew'; seat: Seat; uid: number; card: CardDef }
  | { type: 'turn_started'; seat: Seat; round: number; energy: number }
  | { type: 'played'; seat: Seat; uid: number; card: CardDef; lane: LaneIndex; destroyed: { card: CardDef; owner: Seat } | null }
  | { type: 'ability'; seat: Seat; card: CardDef; text: string }
  | { type: 'round_resolved'; round: number; damage: Record<Seat, number>; hp: Record<Seat, number> }
  | { type: 'game_over'; winner: Seat | 'draw'; reason: 'hp' | 'rounds' | 'forfeit' };

export const opponentOf = (seat: Seat): Seat => (seat === 'bottom' ? 'top' : 'bottom');
export const LANE_NAMES = ['Left', 'Middle', 'Right'] as const;

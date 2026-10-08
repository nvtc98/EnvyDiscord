/** Rules constants. See docs/superpowers/specs/2026-10-04-lane-battle-design.md. */
export const LANES = 3;
export const CELLS = 3;
export const MAX_ENERGY = 9;
export const MAX_TURNS = 18;
export const BALANCE_START = 50;
export const BALANCE_MIN = 0;
export const BALANCE_MAX = 100;
export const DECK_SIZE = 12;
/** Cards drawn before the first turn; every turn then starts with one more draw. */
export const OPENING_HAND = { first: 2, second: 3 } as const;
/** Maximum hand size. A draw past this burns the drawn card (it leaves the deck, never enters the hand). */
export const MAX_HAND = 6;

/** Where a player sits. `bottom` is the human at the bottom of the board, `top` is the opponent. */
export type Seat = "bottom" | "top";
export type LaneIndex = 0 | 1 | 2;

export type ActiveEffect =
  | { kind: "draw"; count: number }
  | { kind: "energy"; amount: number }
  | { kind: "buffLane"; amount: number }
  | { kind: "destroyedPower" } // Stella: set bonus so effective power = destroyedPower tally
  | { kind: "pushLane" } // Siren: extra push step on the lane, far direction
  | { kind: "destroyLane" } // Laser: destroy every other card in the lane
  | { kind: "shuffleRedraw" } // Phantom: shuffle hand+deck together, redraw to the post-play hand size
  | { kind: "buffRowAll"; amount: number }; // Oracle: +amount power to EVERY card in the row (same cell index across all 3 lanes), both seats (self included)
export type ContinuousEffect =
  | { kind: "laneDouble" }
  | { kind: "anchor" }
  | { kind: "pushImmune" } // Bedrock: a push that would carry this off the far edge leaves it at the edge instead of destroying it
  | { kind: "drainStartOfTurn"; amount: number } // Venom: -amount power to every other card each turn start
  | { kind: "transformAt"; count: number; into: string } // Bò SPD: transform into `into` once `count` cards have been destroyed this match
  | { kind: "balanceCoefficient"; k: number } // Bò SPD: contributes `k` to the single global tide coefficient (§6)
  | { kind: "phasing" } // Phasing: an enemy push that would destroy it slips it to a random empty lane instead
  | { kind: "wicked" } // Wicked: gains +1 power whenever any card moves (a `moved` event) while on board
  | { kind: "reflecting" } // Reflecting: an enemy push that displaces it shoves a random other lane one step
  | { kind: "costReduction"; amount: number }; // Gentle: owner's cards cost `amount` less while this is on the board
// "endOfRound" now means the end of each turn (resolution is per-turn, not per-round).
export type EndOfRoundEffect = { kind: "oceanReturn"; amount: number }; // Ocean: +amount to friendlies, then return to deck (phase 2)
export type OnDestroyEffect = { kind: "rebirth"; amount: number }; // Phoenix: return to hand with +amount

/** Active: once, when the card is played. Passive: while on the board, either always or at the end of each round. */
export type Ability =
  | { timing: "active"; effect: ActiveEffect }
  | { timing: "continuous"; effect: ContinuousEffect }
  | { timing: "endOfRound"; effect: EndOfRoundEffect }
  | { timing: "onDestroy"; effect: OnDestroyEffect };

export type Rarity = "common" | "bargain" | "eternal";

/** Which deck/visual family a card belongs to. Absent on a CardDef → "the-eyes" (see cardFaction). */
export type Faction = "the-eyes" | "botuoi";

export interface CardDef {
  id: string;
  name: string;
  /** Used by the story's starter pack. Ordinary packs ignore it. */
  rarity?: Rarity;
  cost: number;
  power: number;
  ability?: Ability;
  /** Rules text shown on the card. Defaults to a description generated from the ability. */
  text?: string;
  /** Which deck/visual family the card belongs to. Absent → "the-eyes" (see cardFaction). */
  faction?: Faction;
  /** Per-card balance-meter coefficient (§6). Absent → 0 (no contribution). */
  coefficient?: number;
}

/** Narrows an exhaustive switch: a reachable call means a union member has no case. */
export function assertNever(x: never): never {
  throw new Error(`Unhandled effect: ${JSON.stringify(x)}`);
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
  /** Tug-of-war meter, 0..100. Higher = bottom (human) winning; 50 = even. */
  balance: number;
  /** Count of turns that have ended and resolved so far (the cap source of truth). */
  turnsPlayed: number;
  winner: Seat | "draw" | null;
  nextUid: number;
  /** Running sum of the actual power of every card destroyed this match, both seats. Read by Stella Eyes. */
  destroyedPower: number;
  /** Number of cards destroyed this match, both seats. Read by transformAt (§5). */
  destroyedCount: number;
}

export interface Play {
  uid: number;
  lane: LaneIndex;
}

export type GameEvent =
  | { type: "drew"; seat: Seat; uid: number; card: CardDef }
  | { type: "burned"; seat: Seat; card: CardDef }
  | { type: "turn_started"; seat: Seat; round: number; energy: number }
  | {
      type: "played";
      seat: Seat;
      uid: number;
      card: CardDef;
      lane: LaneIndex;
      destroyed: { card: CardDef; owner: Seat } | null;
    }
  | { type: "ability"; seat: Seat; card: CardDef; text: string }
  | {
      type: "moved";
      seat: Seat; // owner of the moved card
      uid: number; // the card instance that moved (uid preserved across the move)
      card: CardDef; // its def, for the log sentence
      from: { lane: LaneIndex; cell: number };
      to: { lane: LaneIndex; cell: number };
    }
  | {
      type: "transformed";
      seat: Seat;
      uid: number;
      from: CardDef;
      into: CardDef;
    }
  | {
      type: "tide_shifted";
      /** The applied, clamped shift this turn: new balance minus old balance (what the meter actually moved). */
      delta: number;
      /**
       * The full shift this turn before clamping to 0..100: (bottom power - top power) * k. The battle log
       * shows this so a card's stated pull reads true even when the meter is pinned at an edge. Sign matches
       * `delta`: positive = bottom's board was stronger this turn, negative = top's.
       */
      rawDelta: number;
      /** The balance after this shift, 0..100. */
      balance: number;
      /** turnsPlayed after this resolution (1..18). */
      turn: number;
    }
  | {
      type: "game_over";
      winner: Seat | "draw";
      reason: "balance" | "turns" | "forfeit";
    };

export const opponentOf = (seat: Seat): Seat =>
  seat === "bottom" ? "top" : "bottom";
export const LANE_NAMES = ["Left", "Middle", "Right"] as const;

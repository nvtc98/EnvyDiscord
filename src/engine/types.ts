/** Rules constants. See docs/superpowers/specs/2026-10-04-lane-battle-design.md. */
export const LANES = 3;
export const CELLS = 3;
export const MAX_ENERGY = 9;
export const MAX_TURNS = 18;
export const BALANCE_START = 50;
export const BALANCE_MIN = 0;
export const BALANCE_MAX = 100;
/** Default starting HP for each seat. The meter total = both seats' HP; the start = the bottom seat's HP. */
export const DEFAULT_SEAT_HP = 50;
export const DECK_SIZE = 16;
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
  | { kind: "stellaPush" } // Stella: end of turn, push The Eyes Privilege toward the enemy by the destroyedPower tally — a single one-shot shove, not a per-turn recurring push
  | { kind: "astralDiscount" } // Astral: end of turn, −1 to the cost of each card currently in the owner's hand (one-shot, floors at 0)
  | { kind: "pushLane" } // Siren: extra push step on the lane, far direction
  | { kind: "destroyLane" } // Laser: destroy every other card in the lane
  | { kind: "shuffleRedraw" } // Phantom: shuffle hand+deck together, redraw to the post-play hand size
  | { kind: "buffRowAll"; amount: number } // Oracle: +amount power to EVERY card in the row (same cell index across all 3 lanes), both seats (self included)
  | { kind: "cloneBoard" } // Spectra: clone self into every empty cell on the whole board
  | { kind: "cloneLane" } // Echo: clone self into every empty cell in the played lane
  | { kind: "cloneMirror" } // Dual: if played in a side lane, clone self into the other side lane
  | { kind: "nexusSum" } // Nexus: if played in the middle lane, gain the current power of both side-lane cards in its row
  | { kind: "gentlePush"; percent: number } // Gentle: at end of the owner's turn, push the meter `percent`% of the enemy's HP toward the enemy per friendly passive card
  // The five below carry `timing: "active"` (so they render "Active:") but are NO-OPS on play; they
  // resolve during the OWNER's end-of-turn resolution (resolveTurn's applyEndOfTurnAbilities), mirroring
  // gentlePush. The card having been played earlier that turn arms the effect.
  | { kind: "watcherDig" } // Watcher's: end of turn, draw 1 of the top 3 deck cards by lane (left=weakest, center=middle, right=strongest); non-chosen stay on top
  | { kind: "moonlitSacrifice" } // Moonlit: end of turn, destroy all cards in hand, add their total power to one random friendly on-board card
  | { kind: "titanShift" } // Titan: end of turn, move every OTHER card in this lane (both seats) to one random other lane (as many as fit)
  | { kind: "apexSwap" } // Apex: end of turn, swap places with the owner's frontmost friendly card in this lane
  | { kind: "berserkKill" } // Berserk: end of turn, destroy the card directly in front of this one (toward the enemy edge), friendly or enemy
  // The five below also carry `timing: "active"` and are NO-OPS on play, resolving during the owner's
  // end-of-turn pass (see applyEndOfTurnAbilities). They summon or buff; wiring lands in FEAT-002.
  | { kind: "summonHand" } // Mortal: end of turn, summon a random hand card to the cell in front of this one
  | { kind: "summonDeck" } // Omen: end of turn, summon a random deck card to the cell in front of this one
  | { kind: "vaporSummon" } // Vapor: end of turn, vanish and summon a random higher-cost deck card into its own vacated cell
  | { kind: "chronosSummon" } // Chronos: end of turn, destroy the highest-cost hand card; if still alive next turn, summon it in front
  | { kind: "evilHighest" } // Evil: end of turn, give the owner's highest-cost cards (self included) power equal to that cost
  // The nine below also carry `timing: "active"` and are NO-OPS on play; they resolve during the
  // OWNER's end-of-turn pass (see applyEndOfTurnAbilities), like the actives above.
  | { kind: "joyfulBuff" } // Joyful: end of turn, +1 power to EVERY friendly on-board card (self included)
  | { kind: "goliathGain" } // Goliath: end of turn, gain 0..10 permanent power, higher the more The Eyes Privilege favors the enemy
  | { kind: "frozenLock" } // Frozen: end of turn, lock BOTH players out of playing for the next two upcoming plies
  | { kind: "gloomLane" } // Gloom: end of turn, every enemy card in this lane loses 1 power (permanent)
  | { kind: "sunkenPull" } // Sunken: end of turn, pull the two OTHER lanes one step toward the owner's edge
  | { kind: "opticGain" } // Optic: end of turn, add the cost of one random OTHER card in its own lane (either seat) to its power, once
  | { kind: "killingDeck" } // Killing: end of turn, destroy a random card in the OPPONENT's deck (feeds Stella)
  | { kind: "numbDeck" } // Numb: end of turn, destroy a random card in the OWNER's OWN deck (feeds Stella)
  | { kind: "sunlitScatter" }; // Sunlit: end of turn, destroy the owner's OTHER board cards and spread their power across the hand
export type ContinuousEffect =
  | { kind: "laneDouble" }
  | { kind: "anchor" }
  | { kind: "pushImmune" } // Bedrock: a push that would carry this off the far edge leaves it at the edge instead of destroying it
  | { kind: "drainStartOfTurn"; amount: number } // Venom: -amount power to every other card each turn start
  | { kind: "transformAt"; count: number; into: string } // Bò SPD: transform into `into` once `count` cards have been destroyed this match
  | { kind: "balanceCoefficient"; k: number } // Bò SPD: contributes `k` to the single global tide coefficient (§6)
  | { kind: "phasing" } // Phasing: an enemy push that would destroy it slips it to a random empty lane instead
  | { kind: "wicked" } // Wicked: at the owner's end of turn, if THIS card itself moved during the turn, gain +2 power — at most once per turn, regardless of how many times it moved
  | { kind: "reflecting" } // Reflecting: an enemy push that displaces it shoves a random other lane one step
  | { kind: "costReduction"; amount: number } // Gentle: owner's cards cost `amount` less while this is on the board
  | { kind: "ancientDiscount" } // Ancient: while in the owner's hand, costs 1 less at the end of each of the owner's turns (accumulates on costReduction)
  | { kind: "vaingloryGate" } // Vainglory: playable only while The Eyes Privilege favors the enemy (owner HP < enemy HP)
  | { kind: "guardianLane" }; // Guardian: the owner's cards sharing this card's lane cannot be destroyed
// "endOfRound" now means the end of each turn (resolution is per-turn, not per-round).
export type EndOfRoundEffect =
  | { kind: "oceanReturn"; amount: number } // Ocean: +amount to friendlies, then return to deck (phase 2)
  | { kind: "teamBuffEndOfTurn"; amount: number } // Cosmic: at every end of turn, +amount to the owner's OTHER on-board cards
  | { kind: "wildShift" } // Wild: at the OWNER's end of turn, move one random other card in Wild's lane (either seat) to a random other lane that has room
  | { kind: "flowerBuff" }; // Flower: at the OWNER's end of turn, +1 power to ONE RANDOM friendly on-board card (self eligible)
export type OnDestroyEffect =
  | { kind: "rebirth"; amount: number } // Phoenix: return to hand with +amount
  | { kind: "glacialSpawn"; drop: number } // Glacial: when pushed off the edge (push OR siren), spawn a (power − drop) clone into each other lane, stopping once spawn power ≤ 0
  | { kind: "dispersedSpread" }; // Dispersed: when destroyed (any path), spread its power-at-death randomly across the owner's OTHER remaining board cards
export type OnPlayEffect = {
  kind: "earlyBuff";
  amount: number;
  byTurn: number;
}; // Doran's: on play, if turn ≤ byTurn, gain +amount power permanently

/** Active: once, when the card is played. Passive: while on the board, either always or at the end of each round. */
export type Ability =
  | { timing: "active"; effect: ActiveEffect }
  | { timing: "onPlay"; effect: OnPlayEffect }
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
  /**
   * Classifies the card's rendered rules text: "active" when it starts with "Active:", "passive" when
   * it starts with "Passive:". Absent on vanilla cards (no ability and no explicit text). Source of
   * truth for counting passive cards (e.g. Gentle's end-of-turn push). Must match the prefix cardText prints.
   */
  kind?: "active" | "passive";
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
  /** Chronos: a card destroyed from hand this turn, to be summoned at the end of the owner's NEXT turn. */
  pending?: { def: CardDef; fireOnTurn: number };
  /** Ancient: accumulated in-hand cost discount; absent → 0. Floors the live cost at 0 via instanceCost. */
  costReduction?: number;
}

/**
 * One card sitting in a player's draw pile. Carries an accumulated permanent power `bonus` so a buff
 * applied to a card while it is still in the deck (Ocean's whole-deck buff) travels onto the hand
 * CardInstance when the card is drawn. A freshly built deck has `bonus: 0` on every entry.
 */
export interface DeckCard {
  def: CardDef;
  bonus: number;
}

export interface PlayerState {
  energy: number;
  /** Turns this player has started, counting the current one. */
  turns: number;
  /** Remaining cards, next draw first. Each entry carries its accumulated power bonus (see DeckCard). */
  deck: DeckCard[];
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
  /** Bottom (player) seat's starting HP. The meter starts here and the even point sits here. */
  bottomStartHP: number;
  /** Top (enemy) seat's starting HP. */
  topStartHP: number;
  /**
   * Tug-of-war meter = the bottom (player) seat's remaining HP, in [0, bottomStartHP + topStartHP].
   * The top seat's remaining HP is `total - balance`. Higher = bottom winning; the even point is
   * `bottomStartHP`. With both seats at 50 (today's default) this is the old 0..100 meter starting at 50.
   */
  balance: number;
  /** Count of turns that have ended and resolved so far (the cap source of truth). */
  turnsPlayed: number;
  winner: Seat | "draw" | null;
  nextUid: number;
  /** Running sum of the actual power of every card destroyed this match, both seats. Read by Stella Eyes. */
  destroyedPower: number;
  /** Number of cards destroyed this match, both seats. Read by transformAt (§5). */
  destroyedCount: number;
  /**
   * Frozen's turn-lock counter. 0 = unlocked. Set to 3 when a Frozen resolves (owner end of turn),
   * decremented by 1 at the start of each subsequent turn (startTurn). While > 0, NO card is playable
   * by either seat (canPlay returns `blocked`, legalPlays returns `[]`), covering the opponent's next
   * turn then the owner's next turn before clearing.
   */
  turnLock: number;
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
      type: "cloned";
      seat: Seat; // owner of the clone (= source owner)
      uid: number; // the clone instance's new uid
      card: CardDef; // the shared def, for the log sentence
      lane: LaneIndex;
      cell: number;
    }
  | {
      type: "tide_shifted";
      /** The applied, clamped shift this turn: new balance minus old balance (what the meter actually moved). */
      delta: number;
      /**
       * The full shift this turn before clamping to [0, total] (total = bottomStartHP + topStartHP):
       * (bottom power - top power) * k. The battle log shows this so a card's stated pull reads true even
       * when the meter is pinned at an edge. Sign matches `delta`: positive = bottom's board was stronger
       * this turn, negative = top's.
       */
      rawDelta: number;
      /** The balance after this shift, in [0, total] (total = bottomStartHP + topStartHP). */
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

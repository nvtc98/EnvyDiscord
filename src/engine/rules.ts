import type { Rng } from "../util/rng";
import { shuffle } from "../util/rng";
import { hasContinuous } from "./abilities";
import { entryCell, pushInto, pushMovers, wouldPush } from "./push";
import {
  assertNever,
  BALANCE_START,
  CELLS,
  LANES,
  MAX_ENERGY,
  MAX_HAND,
  MAX_TURNS,
  OPENING_HAND,
  opponentOf,
  type CardDef,
  type CardInstance,
  type Cell,
  type GameEvent,
  type GameState,
  type LaneIndex,
  type Play,
  type Seat,
} from "./types";
import { CARD_INDEX } from "../data/cards";

export interface Step {
  state: GameState;
  events: GameEvent[];
}

const laneIndexes = Array.from({ length: LANES }, (_, i) => i as LaneIndex);

export const BASE_COEFFICIENT = 1;

/** A card's balance coefficient, read from either carrier: the `balanceCoefficient` ability or the `coefficient` field (§6). */
const coefficientOf = (card: CardInstance): number => {
  const ab = card.def.ability;
  if (ab?.timing === "continuous" && ab.effect.kind === "balanceCoefficient")
    return ab.effect.k;
  return card.def.coefficient ?? 0;
};

/**
 * Extra multiplier a coefficient card adds to the global EP factor. A card's own coefficient H means
 * "multiply by H", so a card contributes `H - 1` on top of the baseline (H=1 adds 0 — "normally",
 * H=2 adds 1, H=3 adds 2). Cards with no coefficient (H=0) contribute nothing. Summed over BOTH seats'
 * boards (ownership-independent, §6).
 */
const sumCoefficientBonus = (state: GameState): number => {
  let total = 0;
  for (let lane = 0; lane < LANES; lane++)
    for (let i = 0; i < CELLS; i++) {
      const card = state.lanes[lane][i];
      if (!card) continue;
      const h = coefficientOf(card);
      if (h > 0) total += h - 1;
    }
  return total;
};

/**
 * The single global multiplier applied to this turn's signed board-power difference before it moves
 * the balance: `k = BASE_COEFFICIENT + Σ (H - 1)` over every coefficient card on the board, both seats
 * (the "super reactionary" rule, §6). With no coefficient cards (or only H=1 cards) `k = BASE_COEFFICIENT = 1`
 * — a lone Cấp 1 (H=1) leaves the swing unchanged ("normally"); a Cấp 2 doubles it; a Cấp 3 triples it.
 */
function balanceFactor(state: GameState): number {
  return BASE_COEFFICIENT + sumCoefficientBonus(state);
}

/** Shuffles both decks, deals the opening hands, and starts the first player's first turn. */
export function newGame(
  decks: Record<Seat, CardDef[]>,
  first: Seat,
  rng: Rng,
): Step {
  const second = opponentOf(first);
  const state: GameState = {
    lanes: Array.from({ length: LANES }, () => Array<Cell>(CELLS).fill(null)),
    players: {
      bottom: {
        energy: 0,
        turns: 0,
        deck: shuffle(decks.bottom, rng),
        hand: [],
      },
      top: {
        energy: 0,
        turns: 0,
        deck: shuffle(decks.top, rng),
        hand: [],
      },
    },
    first,
    active: first,
    round: 1,
    balance: BALANCE_START,
    turnsPlayed: 0,
    winner: null,
    nextUid: 1,
    destroyedPower: 0,
    destroyedCount: 0,
  };
  const events: GameEvent[] = [];
  draw(state, first, OPENING_HAND.first, events);
  draw(state, second, OPENING_HAND.second, events);
  startTurn(state, events);
  return { state, events };
}

function draw(
  state: GameState,
  seat: Seat,
  count: number,
  events: GameEvent[],
): void {
  const player = state.players[seat];
  for (let i = 0; i < count && player.deck.length > 0; i++) {
    const card = player.deck.shift()!;
    if (handFull(state, seat)) {
      // Over the cap: the drawn card leaves the deck but never enters the hand.
      events.push({ type: "burned", seat, card });
      continue;
    }
    const instance: CardInstance = {
      uid: state.nextUid++,
      def: card,
      owner: seat,
      bonus: 0,
    };
    player.hand.push(instance);
    events.push({ type: "drew", seat, uid: instance.uid, card });
  }
}

/** True once a seat's hand is at the cap, so a further draw (or revival) must burn instead of enter. */
const handFull = (state: GameState, seat: Seat): boolean =>
  state.players[seat].hand.length >= MAX_HAND;

function startTurn(state: GameState, events: GameEvent[]): void {
  const player = state.players[state.active];
  player.turns += 1;
  // `round` bumps once per pair of turns: when the first player starts a NEW turn
  // (their 2nd onward). The opening turn (turns === 1) keeps round at 1.
  if (state.active === state.first && player.turns > 1) state.round += 1;
  player.energy = Math.min(player.turns, MAX_ENERGY);
  draw(state, state.active, 1, events);
  applyStartOfTurnDrains(state, events);
  events.push({
    type: "turn_started",
    seat: state.active,
    round: state.round,
    energy: player.energy,
  });
}

const cardsOnBoard = (state: GameState): CardInstance[] =>
  state.lanes.flat().filter((c): c is CardInstance => c !== null);

/** The drain amount a Venom (continuous `drainStartOfTurn`) applies, else 0. The kind check narrows the effect. */
const drainAmount = (card: CardInstance): number => {
  const ability = card.def.ability;
  return ability?.timing === "continuous" &&
    ability.effect.kind === "drainStartOfTurn"
    ? ability.effect.amount
    : 0;
};

/**
 * Venom: at the start of every turn (both seats), every non-Venom card on the board loses `totalDrain`
 * power, where `totalDrain` is the sum of every Venom's drain. All Venoms are exempt (self and others).
 * Seat-agnostic: it does not read `state.active`. Power floors at read time, not here.
 */
function applyStartOfTurnDrains(state: GameState, events: GameEvent[]): void {
  const board = cardsOnBoard(state);
  const venoms = board.filter((c) => drainAmount(c) > 0);
  if (venoms.length === 0) return;
  const totalDrain = venoms.reduce((n, v) => n + drainAmount(v), 0);
  const venomUids = new Set(venoms.map((v) => v.uid));
  for (const card of board) {
    if (venomUids.has(card.uid)) continue; // every Venom is exempt (self + other Venoms)
    card.bonus -= totalDrain;
  }
  for (const venom of venoms) {
    events.push({
      type: "ability",
      seat: venom.owner,
      card: venom.def,
      text: `drained ${drainAmount(venom)} power from every other card`,
    });
  }
}

/** True while the card is still protected from the enemy's pushes by Bedrock's shield. */
export const isShielded = (card: CardInstance, state: GameState): boolean =>
  card.shieldedUntil !== undefined &&
  state.players[opponentOf(card.owner)].turns <= card.shieldedUntil;

/** True if a push by `seat` into `cells` would displace a shielded enemy card. */
function pushHitsShieldedEnemy(
  state: GameState,
  cells: readonly Cell[],
  seat: Seat,
): boolean {
  return pushMovers(cells, seat).some((i) => {
    const c = cells[i];
    return c != null && c.owner !== seat && isShielded(c, state);
  });
}

type DestroyCause = "push" | "siren" | "laser";

/**
 * Resolves "card is destroyed." Phoenix (onDestroy: rebirth) intercepts: the card returns to its owner's
 * hand as a fresh instance with `bonus += amount`, and its power is NOT added to the tally. Otherwise the
 * card's actual power at this moment (`Math.max(0, def.power + bonus)`) is added to `state.destroyedPower`.
 * Mutates `state`; the card is already off the board when this runs.
 */
function destroyCard(
  state: GameState,
  card: CardInstance,
  events: GameEvent[],
  _cause: DestroyCause,
): void {
  const ability = card.def.ability;
  if (ability?.timing === "onDestroy" && ability.effect.kind === "rebirth") {
    const amount = ability.effect.amount;
    if (handFull(state, card.owner)) {
      // A revival into a full hand is burned (not tallied) — same early return as a normal rebirth.
      events.push({ type: "burned", seat: card.owner, card: card.def });
      events.push({
        type: "ability",
        seat: card.owner,
        card: card.def,
        text: "could not return — hand was full",
      });
      return; // NOT counted into destroyedPower or destroyedCount
    }
    const revived: CardInstance = {
      uid: state.nextUid++,
      def: card.def,
      owner: card.owner,
      bonus: card.bonus + amount,
    };
    state.players[card.owner].hand.push(revived);
    events.push({
      type: "ability",
      seat: card.owner,
      card: card.def,
      text: `returned to its owner's hand with +${amount} power`,
    });
    return; // NOT counted into destroyedPower or destroyedCount
  }
  state.destroyedPower += Math.max(0, card.def.power + card.bonus);
  state.destroyedCount += 1;
}

/**
 * Transforms every eligible `transformAt` card on the board in place: once the match-wide `destroyedCount`
 * reaches a card's threshold it becomes its target def (position/lane/owner/uid preserved, `bonus` reset to
 * 0). A single sweep (lanes L→R, cells top→bottom); a cell swapped this pass is not revisited, so a chain
 * (Cấp 1 → Cấp 2 → Cấp 3) advances one level per triggering action, not all at once (§5).
 */
function applyTransforms(state: GameState, events: GameEvent[]): void {
  for (let lane = 0; lane < LANES; lane++) {
    const cells = state.lanes[lane];
    for (let i = 0; i < CELLS; i++) {
      const card = cells[i];
      const ab = card?.def.ability;
      if (
        !card ||
        ab?.timing !== "continuous" ||
        ab.effect.kind !== "transformAt"
      )
        continue;
      if (state.destroyedCount < ab.effect.count) continue;
      const target = CARD_INDEX.get(ab.effect.into);
      if (!target) continue; // unknown target id: skip, no event (defended; caught by the self-test)
      const from = card.def;
      card.def = target;
      card.bonus = 0;
      events.push({
        type: "transformed",
        seat: card.owner,
        uid: card.uid,
        from,
        into: target,
      });
    }
  }
}

/**
 * Siren: an extra push step on the whole lane toward the far edge (away from `seat`). Visits cells far-edge
 * first so each card moves into an already-vacated slot. A shielded enemy card stops the shove (it and
 * everything behind it stay put). At most one card falls off the far edge and is routed through `destroyCard`.
 */
function sirenPush(
  state: GameState,
  lane: LaneIndex,
  seat: Seat,
  sirenDef: CardDef,
  events: GameEvent[],
): void {
  const cells = state.lanes[lane];
  const step = seat === "bottom" ? -1 : 1;
  const farEdge = seat === "bottom" ? 0 : CELLS - 1;
  const order: number[] = [];
  for (let k = 0; k < CELLS; k++) order.push(farEdge - step * k); // far edge first, near edge last
  let blocked = false;
  let destroyed: CardInstance | null = null;
  for (const i of order) {
    const occupant = cells[i];
    if (!occupant) continue;
    if (occupant.owner !== seat && isShielded(occupant, state)) {
      blocked = true;
      break;
    }
    const dest = i + step;
    if (dest < 0 || dest >= CELLS) {
      cells[i] = null;
      destroyed = occupant; // at most one card falls off a single-step shove
    } else {
      cells[dest] = occupant;
      cells[i] = null;
    }
  }
  if (destroyed) destroyCard(state, destroyed, events, "siren");
  events.push({
    type: "ability",
    seat,
    card: sirenDef,
    text: blocked
      ? "pushed the lane, blocked by a shielded card"
      : "pushed the lane",
  });
}

interface OceanReturn {
  uid: number;
  owner: Seat;
  lane: LaneIndex;
  amount: number;
}

/** Pass 1: snapshot every oceanReturn instance on the board, lanes L->R, each lane top->bottom. No mutation. */
function collectOceanReturns(state: GameState): OceanReturn[] {
  const out: OceanReturn[] = [];
  state.lanes.forEach((lane, laneIndex) => {
    for (const card of lane) {
      const ability = card?.def.ability;
      if (
        card &&
        ability?.timing === "endOfRound" &&
        ability.effect.kind === "oceanReturn"
      ) {
        out.push({
          uid: card.uid,
          owner: card.owner,
          lane: laneIndex as LaneIndex,
          amount: ability.effect.amount,
        });
      }
    }
  });
  return out;
}

/** Pass 2: buff friendlies +amount (excluding self), remove Ocean, splice its def back into the deck at a seeded slot. */
function applyOceanReturn(
  state: GameState,
  o: OceanReturn,
  events: GameEvent[],
  rng: Rng,
): void {
  const cells = state.lanes[o.lane];
  const idx = cells.findIndex((c) => c?.uid === o.uid);
  if (idx < 0) return; // defensive: already gone
  const card = cells[idx]!;

  for (const l of state.lanes)
    for (const other of l)
      if (other && other.owner === o.owner && other.uid !== card.uid)
        other.bonus += o.amount;
  events.push({
    type: "ability",
    seat: o.owner,
    card: card.def,
    text: `gave +${o.amount} power to allied cards`,
  });

  cells[idx] = null;

  const deck = state.players[o.owner].deck;
  const pos = deck.length === 0 ? 0 : Math.floor(rng() * (deck.length + 1));
  deck.splice(pos, 0, card.def); // CardDef only -> bonus discarded, returns clean
  events.push({
    type: "ability",
    seat: o.owner,
    card: card.def,
    text: "returned to the deck",
  });
}

/** Power a card currently deals: base + permanent buffs, doubled by a friendly `laneDouble` in its lane (never below 0). */
export function effectivePower(
  state: GameState,
  lane: number,
  card: CardInstance,
): number {
  const doubled = state.lanes[lane].some(
    (c) => c && c.owner === card.owner && hasContinuous(c.def, "laneDouble"),
  );
  return Math.max(0, card.def.power + card.bonus) * (doubled ? 2 : 1);
}

/** The damage a seat's cards on the board deal to the other seat at the end of a round. */
export function totalPower(state: GameState, owner: Seat): number {
  let sum = 0;
  state.lanes.forEach((lane, laneIndex) => {
    for (const card of lane)
      if (card && card.owner === owner)
        sum += effectivePower(state, laneIndex, card);
  });
  return sum;
}

export const isAnchored = (lane: readonly Cell[]): boolean =>
  lane.some((c) => c !== null && hasContinuous(c.def, "anchor"));

export type PlayCheck =
  | { ok: true }
  | {
      ok: false;
      reason: "over" | "not-in-hand" | "energy" | "anchored" | "shielded";
    };

export function canPlay(
  state: GameState,
  uid: number,
  lane: LaneIndex,
): PlayCheck {
  if (state.winner) return { ok: false, reason: "over" };
  const player = state.players[state.active];
  const card = player.hand.find((c) => c.uid === uid);
  if (!card) return { ok: false, reason: "not-in-hand" };
  if (card.def.cost > player.energy) return { ok: false, reason: "energy" };
  const cells = state.lanes[lane];
  if (isAnchored(cells) && wouldPush(cells, state.active))
    return { ok: false, reason: "anchored" };
  if (
    wouldPush(cells, state.active) &&
    pushHitsShieldedEnemy(state, cells, state.active)
  )
    return { ok: false, reason: "shielded" };
  return { ok: true };
}

/** Every play the active seat can make right now. */
export function legalPlays(state: GameState): Play[] {
  if (state.winner) return [];
  const plays: Play[] = [];
  for (const card of state.players[state.active].hand) {
    for (const lane of laneIndexes)
      if (canPlay(state, card.uid, lane).ok)
        plays.push({ uid: card.uid, lane });
  }
  return plays;
}

/** Plays a card from the active player's hand into a lane. Does not modify `prev`. */
export function playCard(prev: GameState, uid: number, lane: LaneIndex): Step {
  const check = canPlay(prev, uid, lane);
  if (!check.ok)
    throw new Error(`Cannot play card ${uid} in lane ${lane}: ${check.reason}`);

  const state = structuredClone(prev);
  const events: GameEvent[] = [];
  const seat = state.active;
  const player = state.players[seat];
  const handIndex = player.hand.findIndex((c) => c.uid === uid);
  const [card] = player.hand.splice(handIndex, 1);
  player.energy -= card.def.cost;

  const { lane: nextLane, destroyed } = pushInto(state.lanes[lane], card, seat);
  state.lanes[lane] = nextLane;
  events.push({
    type: "played",
    seat,
    uid,
    card: card.def,
    lane,
    destroyed: destroyed
      ? { card: destroyed.def, owner: destroyed.owner }
      : null,
  });

  // Route the entry-push destruction through destroyCard BEFORE applyActive, so Stella's tally
  // already includes the card her own entry push shoved off.
  if (destroyed) destroyCard(state, destroyed, events, "push");

  const ability = card.def.ability;
  if (ability?.timing === "active") applyActive(state, card, lane, events);

  // After every destroy this action could cause (entry push + any active destroys), sweep the board
  // once so Bò SPD cards transform the instant the match tally crosses their threshold (§5).
  applyTransforms(state, events);
  return { state, events };
}

function applyActive(
  state: GameState,
  card: CardInstance,
  lane: LaneIndex,
  events: GameEvent[],
): void {
  const seat = card.owner;
  const me = state.players[seat];
  const ability = card.def.ability!;
  if (ability.timing !== "active") return; // only called for active abilities; narrows `effect`
  const effect = ability.effect;
  const say = (text: string) =>
    events.push({ type: "ability", seat, card: card.def, text });

  switch (effect.kind) {
    case "draw": {
      const before = me.hand.length;
      draw(state, seat, effect.count, events);
      say(
        `drew ${me.hand.length - before} card${me.hand.length - before === 1 ? "" : "s"}`,
      );
      break;
    }
    case "energy":
      me.energy += effect.amount;
      say(`gained ${effect.amount} energy`);
      break;
    case "buffLane": {
      let buffed = 0;
      for (const other of state.lanes[lane]) {
        if (other && other.uid !== card.uid && other.owner === seat) {
          other.bonus += effect.amount;
          buffed += 1;
        }
      }
      say(
        `gave +${effect.amount} power to ${buffed} other card${buffed === 1 ? "" : "s"}`,
      );
      break;
    }
    case "destroyedPower":
      // Base power is 0, so effective power = tally. Mutates the live board instance by reference.
      card.bonus = state.destroyedPower;
      say(`gained ${state.destroyedPower} power from destroyed cards`);
      break;
    case "shield":
      card.shieldedUntil = state.players[opponentOf(seat)].turns + 1;
      say("cannot be pushed by the enemy this turn");
      break;
    case "pushLane":
      sirenPush(state, lane, seat, card.def, events);
      break;
    case "destroyLane": {
      const cells = state.lanes[lane];
      const destroyedNames: string[] = [];
      for (let i = 0; i < cells.length; i++) {
        const occupant = cells[i];
        if (occupant && occupant.uid !== card.uid) {
          cells[i] = null;
          destroyedNames.push(occupant.def.name);
          destroyCard(state, occupant, events, "laser");
        }
      }
      say(
        destroyedNames.length === 0
          ? "found no other cards to destroy"
          : `destroyed ${destroyedNames.join(", ")}`,
      );
      break;
    }
    default:
      assertNever(effect);
  }
}

function finish(
  state: GameState,
  winner: Seat | "draw",
  reason: "balance" | "turns" | "forfeit",
  events: GameEvent[],
): void {
  state.winner = winner;
  events.push({ type: "game_over", winner, reason });
}

/**
 * Ends the active player's turn. Every turn resolves: the board power difference shifts the balance
 * meter, the turn counter advances, win/draw conditions are checked, then end-of-turn passives (Ocean)
 * run before control passes to the other player.
 */
export function endTurn(prev: GameState, rng: Rng): Step {
  if (prev.winner) throw new Error("The game is already over");
  const state = structuredClone(prev);
  const events: GameEvent[] = [];

  resolveTurn(state, events, rng);
  if (!state.winner) {
    state.active = opponentOf(state.active);
    startTurn(state, events);
  }
  return { state, events };
}

function resolveTurn(state: GameState, events: GameEvent[], rng: Rng): void {
  // 1. Read board power -> 2. apply tide shift -> 3. bump turnsPlayed -> 4. knockout
  // -> 5. cap -> 6. Ocean pass (only if the game continues).
  const k = balanceFactor(state);
  const delta = (totalPower(state, "bottom") - totalPower(state, "top")) * k;
  const before = state.balance;
  state.balance = Math.max(0, Math.min(100, before + delta));
  events.push({
    type: "tide_shifted",
    delta: state.balance - before,
    rawDelta: delta,
    balance: state.balance,
    turn: state.turnsPlayed + 1,
  });
  state.turnsPlayed += 1;

  // Knockout: balance hits an edge.
  if (state.balance >= 100) finish(state, "bottom", "balance", events);
  else if (state.balance <= 0) finish(state, "top", "balance", events);

  // Cap: run out of turns with no knockout -> whoever leads the tide wins.
  if (!state.winner && state.turnsPlayed >= MAX_TURNS) {
    finish(
      state,
      state.balance > 50 ? "bottom" : state.balance < 50 ? "top" : "draw",
      "turns",
      events,
    );
  }

  // Phase B: post-resolution end-of-turn effects (Ocean), only if the game continues.
  if (!state.winner) {
    const oceans = collectOceanReturns(state); // Pass 1: snapshot
    for (const o of oceans) applyOceanReturn(state, o, events, rng); // Pass 2: process live
  }
}

export function forfeit(prev: GameState, seat: Seat): Step {
  const state = structuredClone(prev);
  const events: GameEvent[] = [];
  if (!state.winner) finish(state, opponentOf(seat), "forfeit", events);
  return { state, events };
}

export { entryCell };

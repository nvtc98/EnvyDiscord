import type { Rng } from '../util/rng';
import { shuffle } from '../util/rng';
import { hasContinuous } from './abilities';
import { entryCell, pushInto, wouldPush } from './push';
import {
  CELLS,
  LANES,
  MAX_ENERGY,
  MAX_HP,
  MAX_ROUNDS,
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
} from './types';

export interface Step {
  state: GameState;
  events: GameEvent[];
}

const laneIndexes = Array.from({ length: LANES }, (_, i) => i as LaneIndex);

/** Shuffles both decks, deals the opening hands, and starts the first player's first turn. */
export function newGame(decks: Record<Seat, CardDef[]>, first: Seat, rng: Rng): Step {
  const second = opponentOf(first);
  const state: GameState = {
    lanes: Array.from({ length: LANES }, () => Array<Cell>(CELLS).fill(null)),
    players: {
      bottom: { hp: MAX_HP, energy: 0, turns: 0, deck: shuffle(decks.bottom, rng), hand: [] },
      top: { hp: MAX_HP, energy: 0, turns: 0, deck: shuffle(decks.top, rng), hand: [] },
    },
    first,
    active: first,
    round: 1,
    winner: null,
    nextUid: 1,
  };
  const events: GameEvent[] = [];
  draw(state, first, OPENING_HAND.first, events);
  draw(state, second, OPENING_HAND.second, events);
  startTurn(state, events);
  return { state, events };
}

function draw(state: GameState, seat: Seat, count: number, events: GameEvent[]): void {
  const player = state.players[seat];
  for (let i = 0; i < count && player.deck.length > 0; i++) {
    const card = player.deck.shift()!;
    const instance: CardInstance = { uid: state.nextUid++, def: card, owner: seat, bonus: 0 };
    player.hand.push(instance);
    events.push({ type: 'drew', seat, uid: instance.uid, card });
  }
}

function startTurn(state: GameState, events: GameEvent[]): void {
  const player = state.players[state.active];
  player.turns += 1;
  player.energy = Math.min(player.turns, MAX_ENERGY);
  draw(state, state.active, 1, events);
  events.push({ type: 'turn_started', seat: state.active, round: state.round, energy: player.energy });
}

const cardsOnBoard = (state: GameState): CardInstance[] => state.lanes.flat().filter((c): c is CardInstance => c !== null);

/** Power a card currently deals: base + permanent buffs, doubled by a friendly `laneDouble` in its lane (never below 0). */
export function effectivePower(state: GameState, lane: number, card: CardInstance): number {
  const doubled = state.lanes[lane].some((c) => c && c.owner === card.owner && hasContinuous(c.def, 'laneDouble'));
  return Math.max(0, card.def.power + card.bonus) * (doubled ? 2 : 1);
}

/** The damage a seat's cards on the board deal to the other seat at the end of a round. */
export function totalPower(state: GameState, owner: Seat): number {
  let sum = 0;
  state.lanes.forEach((lane, laneIndex) => {
    for (const card of lane) if (card && card.owner === owner) sum += effectivePower(state, laneIndex, card);
  });
  return sum;
}

export const isAnchored = (lane: readonly Cell[]): boolean => lane.some((c) => c !== null && hasContinuous(c.def, 'anchor'));

export type PlayCheck = { ok: true } | { ok: false; reason: 'over' | 'not-in-hand' | 'energy' | 'anchored' };

export function canPlay(state: GameState, uid: number, lane: LaneIndex): PlayCheck {
  if (state.winner) return { ok: false, reason: 'over' };
  const player = state.players[state.active];
  const card = player.hand.find((c) => c.uid === uid);
  if (!card) return { ok: false, reason: 'not-in-hand' };
  if (card.def.cost > player.energy) return { ok: false, reason: 'energy' };
  const cells = state.lanes[lane];
  if (isAnchored(cells) && wouldPush(cells, state.active)) return { ok: false, reason: 'anchored' };
  return { ok: true };
}

/** Every play the active seat can make right now. */
export function legalPlays(state: GameState): Play[] {
  if (state.winner) return [];
  const plays: Play[] = [];
  for (const card of state.players[state.active].hand) {
    for (const lane of laneIndexes) if (canPlay(state, card.uid, lane).ok) plays.push({ uid: card.uid, lane });
  }
  return plays;
}

/** Plays a card from the active player's hand into a lane. Does not modify `prev`. */
export function playCard(prev: GameState, uid: number, lane: LaneIndex): Step {
  const check = canPlay(prev, uid, lane);
  if (!check.ok) throw new Error(`Cannot play card ${uid} in lane ${lane}: ${check.reason}`);

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
    type: 'played',
    seat,
    uid,
    card: card.def,
    lane,
    destroyed: destroyed ? { card: destroyed.def, owner: destroyed.owner } : null,
  });

  const ability = card.def.ability;
  if (ability?.timing === 'active') applyActive(state, card, lane, events);
  return { state, events };
}

function applyActive(state: GameState, card: CardInstance, lane: LaneIndex, events: GameEvent[]): void {
  const seat = card.owner;
  const me = state.players[seat];
  const foe = state.players[opponentOf(seat)];
  const effect = card.def.ability!.effect;
  const say = (text: string) => events.push({ type: 'ability', seat, card: card.def, text });

  switch (effect.kind) {
    case 'heal': {
      const before = me.hp;
      me.hp = Math.min(MAX_HP, me.hp + effect.amount);
      say(`healed ${me.hp - before} HP`);
      break;
    }
    case 'damage':
      foe.hp -= effect.amount;
      say(`dealt ${effect.amount} damage`);
      if (foe.hp <= 0) finish(state, seat, 'hp', events);
      break;
    case 'draw': {
      const before = me.hand.length;
      draw(state, seat, effect.count, events);
      say(`drew ${me.hand.length - before} card${me.hand.length - before === 1 ? '' : 's'}`);
      break;
    }
    case 'energy':
      me.energy += effect.amount;
      say(`gained ${effect.amount} energy`);
      break;
    case 'buffLane': {
      let buffed = 0;
      for (const other of state.lanes[lane]) {
        if (other && other.uid !== card.uid && other.owner === seat) {
          other.bonus += effect.amount;
          buffed += 1;
        }
      }
      say(`gave +${effect.amount} power to ${buffed} other card${buffed === 1 ? '' : 's'}`);
      break;
    }
  }
}

function finish(state: GameState, winner: Seat | 'draw', reason: 'hp' | 'rounds' | 'forfeit', events: GameEvent[]): void {
  state.winner = winner;
  events.push({ type: 'game_over', winner, reason });
}

/**
 * Ends the active player's turn. After the first player this starts the second player's turn; after the second
 * player it resolves the round (end-of-round passives, then damage) and starts the next round.
 */
export function endTurn(prev: GameState): Step {
  if (prev.winner) throw new Error('The game is already over');
  const state = structuredClone(prev);
  const events: GameEvent[] = [];

  if (state.active === state.first) {
    state.active = opponentOf(state.first);
    startTurn(state, events);
    return { state, events };
  }

  resolveRound(state, events);
  if (!state.winner) {
    state.round += 1;
    state.active = state.first;
    startTurn(state, events);
  }
  return { state, events };
}

function resolveRound(state: GameState, events: GameEvent[]): void {
  // End-of-round passives, lane by lane (Left to Right), each lane top to bottom.
  for (const lane of state.lanes) {
    for (const card of lane) {
      const ability = card?.def.ability;
      if (!card || ability?.timing !== 'endOfRound') continue;
      const owner = state.players[card.owner];
      const before = owner.hp;
      owner.hp = Math.min(MAX_HP, owner.hp + ability.effect.amount);
      events.push({ type: 'ability', seat: card.owner, card: card.def, text: `healed ${owner.hp - before} HP at the end of the round` });
    }
  }

  const damage: Record<Seat, number> = { bottom: totalPower(state, 'top'), top: totalPower(state, 'bottom') };
  state.players.bottom.hp -= damage.bottom;
  state.players.top.hp -= damage.top;
  const hp: Record<Seat, number> = { bottom: state.players.bottom.hp, top: state.players.top.hp };
  events.push({ type: 'round_resolved', round: state.round, damage, hp });

  const bottomDown = hp.bottom <= 0;
  const topDown = hp.top <= 0;
  if (bottomDown || topDown) {
    finish(state, bottomDown && topDown ? 'draw' : bottomDown ? 'top' : 'bottom', 'hp', events);
  } else if (state.round >= MAX_ROUNDS) {
    finish(state, hp.bottom === hp.top ? 'draw' : hp.bottom > hp.top ? 'bottom' : 'top', 'rounds', events);
  }
}

export function forfeit(prev: GameState, seat: Seat): Step {
  const state = structuredClone(prev);
  const events: GameEvent[] = [];
  if (!state.winner) finish(state, opponentOf(seat), 'forfeit', events);
  return { state, events };
}

export { entryCell };

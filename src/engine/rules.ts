import type { Rng } from "../util/rng";
import { mulberry32, pick, shuffle } from "../util/rng";
import { hasContinuous, isPushImmune } from "./abilities";
import { entryCell, pushInto, wouldPush } from "./push";
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
  type ContinuousEffect,
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
 * first so each card moves into an already-vacated slot. A push-immune card at the far edge is never
 * destroyed: it stays in place and acts as a WALL (cards whose destination is its cell stay put). At most
 * one non-immune card falls off the far edge and is routed through `destroyCard`.
 */
function sirenPush(
  state: GameState,
  lane: LaneIndex,
  seat: Seat,
  sirenDef: CardDef,
  events: GameEvent[],
  rng: Rng,
  fires: { n: number },
): void {
  const cells = state.lanes[lane];
  // Snapshot enemy-owned Reflecting cards in this lane BEFORE the shove, to detect displacement after.
  const reflSnapshot = snapshotReflecting(state, lane, seat);
  const step = seat === "bottom" ? -1 : 1;
  const farEdge = seat === "bottom" ? 0 : CELLS - 1;
  const order: number[] = [];
  for (let k = 0; k < CELLS; k++) order.push(farEdge - step * k); // far edge first, near edge last
  let destroyed: CardInstance | null = null;
  let blockedAt: number | null = null; // cell index of an immune card that walls the shove
  for (const i of order) {
    const occupant = cells[i];
    if (!occupant) continue;
    const dest = i + step;
    // Immune card at the far edge: it stays, and it becomes a wall for the cards behind it.
    if ((dest < 0 || dest >= CELLS) && isPushImmune(occupant.def)) {
      blockedAt = i;
      continue;
    }
    // A card whose destination is the wall cannot advance: it stays put and extends the wall by one
    // cell (so the next card behind it also cannot advance into the occupied cell it left).
    if (blockedAt !== null && dest === blockedAt) {
      blockedAt = i;
      continue;
    }
    if (dest < 0 || dest >= CELLS) {
      cells[i] = null;
      destroyed = occupant; // at most one card falls off a single-step shove
    } else {
      cells[dest] = occupant;
      cells[i] = null;
    }
  }
  if (destroyed)
    resolvePushedOffCard(
      state,
      destroyed,
      lane,
      seat,
      events,
      "siren",
      rng,
      fires,
    );
  events.push({
    type: "ability",
    seat,
    card: sirenDef,
    text: "pushed the lane",
  });
  // Reflecting answers each displaced snapshot (after the Siren log line).
  fireReflecting(
    state,
    lane,
    seat,
    reflSnapshot,
    destroyed ? destroyed.uid : null,
    events,
    rng,
    fires,
  );
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

/**
 * A card's cost for `seat` right now: base cost minus 1 per `costReduction` (Gentle) card of `seat` on
 * the board, floored at 0. Board-state-derived, so it tracks Gentle entering/leaving automatically.
 * Multiple Gentles stack. Uses an inline continuous/kind check (hasContinuous's narrow type cannot be
 * widened to the new kinds — design C.2).
 */
export function effectiveCost(
  state: GameState,
  seat: Seat,
  card: CardDef,
): number {
  let reduction = 0;
  for (let lane = 0; lane < LANES; lane++)
    for (let i = 0; i < CELLS; i++) {
      const c = state.lanes[lane][i];
      if (
        c &&
        c.owner === seat &&
        c.def.ability?.timing === "continuous" &&
        c.def.ability.effect.kind === "costReduction"
      )
        reduction += c.def.ability.effect.amount;
    }
  return Math.max(0, card.cost - reduction);
}

export type PlayCheck =
  | { ok: true }
  | {
      ok: false;
      reason: "over" | "not-in-hand" | "energy" | "anchored";
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
  if (effectiveCost(state, state.active, card.def) > player.energy)
    return { ok: false, reason: "energy" };
  const cells = state.lanes[lane];
  if (isAnchored(cells) && wouldPush(cells, state.active))
    return { ok: false, reason: "anchored" };
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

/** True when `lane` is completely empty (all cells null). */
const laneIsEmpty = (cells: readonly Cell[]): boolean =>
  cells.every((c) => c === null);

/** The lane indices (0..LANES-1) that are completely empty right now. */
function emptyLanes(state: GameState): LaneIndex[] {
  const out: LaneIndex[] = [];
  for (let lane = 0; lane < LANES; lane++)
    if (laneIsEmpty(state.lanes[lane])) out.push(lane as LaneIndex);
  return out;
}

/** True if `card` carries the given continuous effect kind (inline check — hasContinuous's type is narrow). */
function hasContinuousKind(
  card: CardDef,
  kind: ContinuousEffect["kind"],
): boolean {
  const ab = card.ability;
  return ab?.timing === "continuous" && ab.effect.kind === kind;
}

/**
 * Moves `card` (same uid/owner/bonus — the whole instance by reference) into `toLane` at the
 * entry cell for the card's owner, emitting a `moved` event. precondition: toLane is empty — this does a
 * DIRECT placement at entryCell(owner) with NO occupancy check, so the caller must verify the target
 * lane is empty (Phasing's emptyLanes guard). The caller must already have removed the card from its
 * origin cell.
 */
function moveCardToEmptyLane(
  state: GameState,
  card: CardInstance,
  from: { lane: LaneIndex; cell: number },
  toLane: LaneIndex,
  events: GameEvent[],
): void {
  const cell = entryCell(card.owner);
  state.lanes[toLane][cell] = card;
  events.push({
    type: "moved",
    seat: card.owner,
    uid: card.uid,
    card: card.def,
    from,
    to: { lane: toLane, cell },
  });
}

// Reaction-fire cap: counts phantom-push FIRES (not raw recursion/step depth), set comfortably above
// the natural bound. See the recursion-termination argument above phantomPush (design Part D.5).
const REACTION_FIRE_CAP = LANES * CELLS * 2;

/**
 * Resolve a card that an ENEMY push has shoved off the far edge. Phasing may redirect it to a random
 * empty lane (a move) instead of dying; otherwise it is destroyed. `actor` is the seat whose action
 * caused the push. Returns true if the card was rescued (moved) rather than destroyed.
 *
 * precondition for `pick`: it is called ONLY inside the `emptyLanes.length > 0` branch, so it is never
 * handed an empty array (design D.1, MEDIUM-2). Preserve this guard-then-pick ordering.
 */
function resolvePushedOffCard(
  state: GameState,
  card: CardInstance,
  fromLane: LaneIndex,
  actor: Seat,
  events: GameEvent[],
  cause: DestroyCause,
  rng: Rng,
  fires: { n: number },
): boolean {
  if (card.owner !== actor && hasContinuousKind(card.def, "phasing")) {
    const empties = emptyLanes(state);
    if (empties.length > 0) {
      // pick is reachable only here, where empties is provably non-empty.
      const chosen = pick(empties, rng);
      // The card is already off the board; record a synthetic far-edge origin cell (cosmetic — the
      // `moved` describeEvent reads only `to`).
      const farEdge = actor === "bottom" ? 0 : CELLS - 1;
      moveCardToEmptyLane(
        state,
        card,
        { lane: fromLane, cell: farEdge },
        chosen,
        events,
      );
      return true;
    }
  }
  destroyCard(state, card, events, cause);
  return false;
}

/*
 * Recursion-termination argument (design Part D.5). The only recursive edge is a phantom push (or
 * Phasing move) causing another push that triggers another Reflecting/Phasing. Termination is
 * guaranteed by a strict monotone decrease plus a per-action cap:
 *   1. Phantom pushes never add cards — occupancy is non-increasing, strictly decreasing when a card
 *      falls off the edge.
 *   2. A phantom push that destroys none moves cards strictly toward the far edge; the sum of
 *      distances-to-far-edge strictly decreases and is bounded below by 0.
 *   3. Phasing's move relocates one card to an empty lane; it does not create cards and happens only
 *      instead of a destruction.
 *   4. Reflecting fires at most once per displacement, only from an enemy actor, and never targets its
 *      own lane, so it cannot directly re-displace itself.
 *   5. Hard cap (belt): a shared `fires` counter counts reaction FIRES (phantom pushes), capped at
 *      LANES*CELLS*2 (=18). On hitting the cap, stop firing further reactions; the already-applied
 *      board stands (no rollback), no event is emitted. Unreachable in normal play.
 */
function phantomPush(
  state: GameState,
  lane: LaneIndex,
  actor: Seat,
  events: GameEvent[],
  rng: Rng,
  fires: { n: number },
  reflectingOwner: Seat,
  reflectingDef: CardDef,
): void {
  if (fires.n >= REACTION_FIRE_CAP) return; // cap: stop firing, board stands, no event
  fires.n += 1;
  const cells = state.lanes[lane];
  const empty = laneIsEmpty(cells);
  const step = actor === "bottom" ? -1 : 1;
  const farEdge = actor === "bottom" ? 0 : CELLS - 1;
  let destroyed: CardInstance | null = null;
  let blockedAt: number | null = null; // cell index of an immune card that walls the shove
  // Visit the far edge first (like sirenPush) so each card slides into a vacated slot.
  for (let k = 0; k < CELLS; k++) {
    const i = farEdge - step * k;
    const occupant = cells[i];
    if (!occupant) continue;
    const dest = i + step;
    // Immune card at the far edge: it stays, and it becomes a wall for the cards behind it.
    if ((dest < 0 || dest >= CELLS) && isPushImmune(occupant.def)) {
      blockedAt = i;
      continue;
    }
    // A card whose destination is the wall cannot advance: it stays put and extends the wall by one
    // cell (so the next card behind it also cannot advance into the occupied cell it left).
    if (blockedAt !== null && dest === blockedAt) {
      blockedAt = i;
      continue;
    }
    if (dest < 0 || dest >= CELLS) {
      cells[i] = null;
      destroyed = occupant; // at most one card falls off a single-step shove
    } else {
      cells[dest] = occupant;
      cells[i] = null;
    }
  }
  if (destroyed)
    resolvePushedOffCard(
      state,
      destroyed,
      lane,
      actor,
      events,
      "push",
      rng,
      fires,
    );
  events.push({
    type: "ability",
    seat: reflectingOwner,
    card: reflectingDef,
    text: empty ? "rippled an empty lane" : "pushed another lane in answer",
  });
}

/**
 * Snapshot of an enemy-owned Reflecting card present in a lane before a push, so displacement can be
 * detected by comparing cells after the push resolves.
 */
interface ReflSnapshot {
  uid: number;
  cell: number;
  def: CardDef;
  owner: Seat;
  lane: LaneIndex;
}

/** Enemy-owned (relative to `actor`) Reflecting cards currently in `lane`, with their cell indices. */
function snapshotReflecting(
  state: GameState,
  lane: LaneIndex,
  actor: Seat,
): ReflSnapshot[] {
  const out: ReflSnapshot[] = [];
  const cells = state.lanes[lane];
  for (let i = 0; i < CELLS; i++) {
    const c = cells[i];
    if (c && c.owner !== actor && hasContinuousKind(c.def, "reflecting"))
      out.push({ uid: c.uid, cell: i, def: c.def, owner: c.owner, lane });
  }
  return out;
}

/**
 * For each snapshotted Reflecting card displaced by the just-resolved push (its uid moved to a
 * different cell in `lane`, or it is the `destroyedUid` that was shoved off), fire one phantom push on
 * a random OTHER lane. `actor` is the Reflecting card's enemy (the push's actor). The other-lanes array
 * is always length 2, so pick never gets an empty array (design D.1/D.3).
 */
function fireReflecting(
  state: GameState,
  lane: LaneIndex,
  actor: Seat,
  snapshot: ReflSnapshot[],
  destroyedUid: number | null,
  events: GameEvent[],
  rng: Rng,
  fires: { n: number },
): void {
  for (const s of snapshot) {
    const nowCell = state.lanes[lane].findIndex((c) => c?.uid === s.uid);
    const displaced =
      s.uid === destroyedUid || (nowCell !== -1 && nowCell !== s.cell);
    if (!displaced) continue;
    const others = ([0, 1, 2] as LaneIndex[]).filter((l) => l !== lane);
    const target = pick(others, rng);
    phantomPush(state, target, actor, events, rng, fires, s.owner, s.def);
  }
}

/** Count every `moved` event and bump each on-board Wicked's bonus by that count (design D.2). */
function applyMoveReactions(state: GameState, events: GameEvent[]): void {
  const moves = events.filter((e) => e.type === "moved").length;
  if (moves === 0) return;
  for (let lane = 0; lane < LANES; lane++)
    for (let i = 0; i < CELLS; i++) {
      const c = state.lanes[lane][i];
      if (c && hasContinuousKind(c.def, "wicked")) {
        c.bonus += moves;
        events.push({
          type: "ability",
          seat: c.owner,
          card: c.def,
          text: `gained ${moves} power from movement`,
        });
      }
    }
}

/** Plays a card from the active player's hand into a lane. Does not modify `prev`. */
export function playCard(
  prev: GameState,
  uid: number,
  lane: LaneIndex,
  rng: Rng = mulberry32(prev.nextUid),
): Step {
  const check = canPlay(prev, uid, lane);
  if (!check.ok)
    throw new Error(`Cannot play card ${uid} in lane ${lane}: ${check.reason}`);

  const state = structuredClone(prev);
  const events: GameEvent[] = [];
  const seat = state.active;
  const player = state.players[seat];
  const handIndex = player.hand.findIndex((c) => c.uid === uid);
  const [card] = player.hand.splice(handIndex, 1);
  // Charge the discounted cost (Gentle), the same value canPlay gated on.
  player.energy -= effectiveCost(state, seat, card.def);

  const fires = { n: 0 }; // shared reaction-fire counter for this action (phantom-push cap)

  // Snapshot enemy-owned Reflecting cards in the target lane BEFORE the entry push, to detect
  // displacement afterward (design D.4 step 2).
  const entryReflSnapshot = snapshotReflecting(state, lane, seat);

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

  // Resolve the entry-push off-edge card: Phasing may redirect it, else it is destroyed (BEFORE
  // applyActive so Stella's tally already includes the card this entry push shoved off).
  if (destroyed)
    resolvePushedOffCard(
      state,
      destroyed,
      lane,
      seat,
      events,
      "push",
      rng,
      fires,
    );

  // Reflecting answers: for each snapshotted enemy Reflecting that the entry push displaced, fire one
  // phantom push on a random other lane (design D.4 step 5).
  fireReflecting(
    state,
    lane,
    seat,
    entryReflSnapshot,
    destroyed ? destroyed.uid : null,
    events,
    rng,
    fires,
  );

  const ability = card.def.ability;
  if (ability?.timing === "active")
    applyActive(state, card, lane, events, rng, fires);

  // Wicked reads every `moved` event emitted in this action (entry/Siren Phasing relocations).
  applyMoveReactions(state, events);

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
  rng: Rng,
  fires: { n: number },
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
    case "pushLane":
      sirenPush(state, lane, seat, card.def, events, rng, fires);
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
    case "shuffleRedraw": {
      // Phantom was already spliced from me.hand in playCard, so me.hand.length is the post-play size.
      const before = me.hand.length;
      const pool = [...me.hand.map((c) => c.def), ...me.deck]; // defs only; board cards untouched
      me.hand = []; // clear instances (defs preserved in pool)
      me.deck = shuffle(pool, rng);
      draw(state, seat, before, events); // redraw to the post-play size; draw() enforces MAX_HAND
      say(
        `shuffled their hand into the deck and drew ${me.hand.length} card${me.hand.length === 1 ? "" : "s"}`,
      );
      break;
    }
    case "buffRowAll": {
      // Oracle buffs EVERY card in the ROW — the same cell index across all 3 lanes — both seats,
      // including itself (no uid/owner exclusion). Oracle's row cell is its own landing cell.
      const rowCell = state.lanes[lane].findIndex((c) => c?.uid === card.uid);
      let buffed = 0;
      for (let l = 0; l < LANES; l++) {
        const occupant = state.lanes[l][rowCell];
        if (occupant) {
          occupant.bonus += effect.amount;
          buffed += 1;
        }
      }
      say(`gave +${effect.amount} power to every card in this row (${buffed})`);
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

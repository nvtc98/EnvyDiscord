import type { Rng } from "../util/rng";
import { mulberry32, pick, shuffle } from "../util/rng";
import { hasContinuous, isPushImmune } from "./abilities";
import { entryCell, pushAbsorbed, pushInto, wouldPush } from "./push";
import {
  assertNever,
  CELLS,
  DEFAULT_SEAT_HP,
  LANE_NAMES,
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
  type DeckCard,
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

/** Wraps raw card defs into fresh deck entries (bonus 0) for one seat. */
const freshDeck = (defs: readonly CardDef[]): DeckCard[] =>
  defs.map((def) => ({ def, bonus: 0 }));

/**
 * Shuffles both decks, deals the opening hands, and starts the first player's first turn. `hp` sets
 * each seat's starting HP: the meter total is `hp.bottom + hp.top` and the meter starts at `hp.bottom`.
 * Both default to 50, so a default game is byte-identical to the old 0..100 meter starting at 50.
 */
export function newGame(
  decks: Record<Seat, CardDef[]>,
  first: Seat,
  rng: Rng,
  hp: { bottom: number; top: number } = {
    bottom: DEFAULT_SEAT_HP,
    top: DEFAULT_SEAT_HP,
  },
): Step {
  const second = opponentOf(first);
  const state: GameState = {
    lanes: Array.from({ length: LANES }, () => Array<Cell>(CELLS).fill(null)),
    players: {
      bottom: {
        energy: 0,
        turns: 0,
        deck: shuffle(freshDeck(decks.bottom), rng),
        hand: [],
      },
      top: {
        energy: 0,
        turns: 0,
        deck: shuffle(freshDeck(decks.top), rng),
        hand: [],
      },
    },
    first,
    active: first,
    round: 1,
    bottomStartHP: hp.bottom,
    topStartHP: hp.top,
    balance: hp.bottom,
    turnsPlayed: 0,
    winner: null,
    nextUid: 1,
    destroyedPower: 0,
    destroyedCount: 0,
    turnLock: 0,
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
    const entry = player.deck.shift()!;
    const card = entry.def;
    if (handFull(state, seat)) {
      // Over the cap: the drawn card leaves the deck but never enters the hand.
      events.push({ type: "burned", seat, card });
      continue;
    }
    const instance: CardInstance = {
      uid: state.nextUid++,
      def: card,
      owner: seat,
      // Carry the bonus accumulated while the card sat in the deck (e.g. Ocean's whole-deck buff).
      bonus: entry.bonus,
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
  // Frozen's lock counts down one per turn start. Frozen resolves at the owner's end of turn (turnLock=3)
  // BEFORE control passes, so the opponent's next startTurn decrements 3→2 (locked) and the owner's
  // following startTurn decrements 2→1 (locked). The next opponent startTurn decrements 1→0, clearing it.
  if (state.turnLock > 0) state.turnLock -= 1;
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
 * Places a fresh clone of `source` into the (caller-verified EMPTY) cell `lanes[lane][cell]`.
 * The clone shares the source's def (so name/art/description render identically) and owner, gets
 * a new uid, and has `bonus` set so its CURRENT power equals `targetPower`
 * (bonus = targetPower - def.power). A clone is PLACED, never "played": applyActive is NEVER
 * run for it, so active clone chains cannot recurse (Spectra/Echo/Dual/Nexus clones never clone
 * again). Passive effects on the shared def still apply to the clone (this matters only for
 * Glacial's onDestroy chain, which carries its own termination guard). Emits a `cloned` event.
 * precondition: lanes[lane][cell] === null (verified by the caller).
 */
function cloneInto(
  state: GameState,
  source: CardInstance,
  lane: LaneIndex,
  cell: number,
  targetPower: number,
  events: GameEvent[],
): CardInstance {
  const clone: CardInstance = {
    uid: state.nextUid++,
    def: source.def,
    owner: source.owner,
    bonus: targetPower - source.def.power,
  };
  state.lanes[lane][cell] = clone;
  events.push({
    type: "cloned",
    seat: source.owner,
    uid: clone.uid,
    card: source.def,
    lane,
    cell,
  });
  return clone;
}

/**
 * The cell directly in front of `(owner, cell)` toward the enemy edge: bottom steps up (cell − 1),
 * top steps down (cell + 1). Mirrors applyBerserkKill's `step` math. The result may be out of
 * [0, CELLS); callers must range-check before using it as a summon target.
 */
function frontCell(owner: Seat, cell: number): number {
  return cell + (owner === "bottom" ? -1 : 1);
}

/**
 * A hand card's live cost: the board-discounted effectiveCost minus the card's accumulated per-instance
 * Ancient reduction, floored at 0. Composes Gentle (board) and Ancient (in-hand) discounts.
 */
export function instanceCost(
  state: GameState,
  seat: Seat,
  card: CardInstance,
): number {
  return Math.max(
    0,
    effectiveCost(state, seat, card.def) - (card.costReduction ?? 0),
  );
}

/**
 * True when `card` is Guardian-protected in `lane`: some card in that lane shares `card.owner` and
 * carries the continuous `guardianLane` effect (a Guardian protects its own owner's cards in its lane,
 * including itself; never the enemy's). Used to skip owner-friendly cards in every destruction path.
 */
function isGuardianProtected(
  state: GameState,
  lane: LaneIndex,
  card: CardInstance,
): boolean {
  return state.lanes[lane].some(
    (g) =>
      g !== null &&
      g.owner === card.owner &&
      g.def.ability?.timing === "continuous" &&
      g.def.ability.effect.kind === "guardianLane",
  );
}

/**
 * Summons a fresh card from off the board directly into the caller-verified-EMPTY cell
 * `lanes[lane][cell]`, then runs the SAME on-play path playCard uses so a summoned card behaves
 * identically to a played one. NO pushInto, NO cost charge. Unlike cloneInto, a summon DOES fire the
 * card's active/onPlay. Emits an `ability` event on the SUMMONER ("summoned <name>"); does NOT emit
 * `played` (would double-count) or `moved` (a placement is not a move of an existing board card).
 * precondition: lanes[lane][cell] === null (verified by the caller).
 */
function summonInto(
  state: GameState,
  summoner: CardInstance,
  def: CardDef,
  bonus: number,
  lane: LaneIndex,
  cell: number,
  events: GameEvent[],
  rng: Rng,
  fires: { n: number },
): CardInstance {
  const summoned: CardInstance = {
    uid: state.nextUid++,
    def,
    owner: summoner.owner,
    bonus,
  };
  state.lanes[lane][cell] = summoned;
  const ability = def.ability;
  if (ability?.timing === "active")
    applyActive(state, summoned, lane, events, rng, fires);
  if (ability?.timing === "onPlay") applyOnPlay(state, summoned, events);
  events.push({
    type: "ability",
    seat: summoner.owner,
    card: summoner.def,
    text: `summoned ${def.name}`,
  });
  return summoned;
}

/**
 * The first empty cell in `lane` scanned from `owner`'s entry edge inward (owner's edge first),
 * or null if the lane has no empty cell. For bottom that is cell 2 → 1 → 0; for top, 0 → 1 → 2.
 */
function nearestEmptyCell(
  state: GameState,
  lane: LaneIndex,
  owner: Seat,
): number | null {
  const start = entryCell(owner); // bottom → 2, top → 0
  const step = owner === "bottom" ? -1 : 1;
  for (let i = start; i >= 0 && i < CELLS; i += step)
    if (state.lanes[lane][i] === null) return i;
  return null;
}

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
  cause: DestroyCause,
  lane: LaneIndex,
  rng: Rng,
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
  if (
    ability?.timing === "onDestroy" &&
    ability.effect.kind === "glacialSpawn"
  ) {
    // Count Glacial's power into the tally FIRST (it is really destroyed; unlike Phoenix it does not
    // dodge the tally), then spawn the next generation on a push/siren off-edge destruction.
    state.destroyedPower += Math.max(0, card.def.power + card.bonus);
    state.destroyedCount += 1;
    if (cause === "push" || cause === "siren")
      spawnGlacial(state, card, ability.effect.drop, lane, events);
    return;
  }
  if (
    ability?.timing === "onDestroy" &&
    ability.effect.kind === "dispersedSpread"
  ) {
    // Dispersed is really destroyed (tally first, like Glacial), then its power-at-death is spread
    // randomly across the owner's OTHER remaining board cards. None → power lost.
    const power = Math.max(0, card.def.power + card.bonus);
    state.destroyedPower += power;
    state.destroyedCount += 1;
    const others: CardInstance[] = [];
    for (let l = 0; l < LANES; l++)
      for (let i = 0; i < CELLS; i++) {
        const c = state.lanes[l][i];
        if (c && c.owner === card.owner && c.uid !== card.uid) others.push(c);
      }
    const spread = spreadPowerRandomly(others, power, rng);
    events.push({
      type: "ability",
      seat: card.owner,
      card: card.def,
      text:
        spread > 0
          ? `scattered ${spread} power across your other cards`
          : "scattered, but no cards remained to receive its power",
    });
    return;
  }
  state.destroyedPower += Math.max(0, card.def.power + card.bonus);
  state.destroyedCount += 1;
}

/**
 * Glacial's onDestroy chain: spawn one clone into EACH of the two lanes OTHER than Glacial's own
 * lane, each carrying `card`'s power-at-death minus `drop`, into the empty cell nearest the owner's
 * side. A lane with no empty cell is skipped. The chain TERMINATES because spawn power strictly
 * decreases by `drop` (≥1) each generation and we never spawn when it would be ≤ 0.
 */
function spawnGlacial(
  state: GameState,
  card: CardInstance,
  drop: number,
  myLane: LaneIndex,
  events: GameEvent[],
): void {
  const spawnPower = card.def.power + card.bonus - drop;
  if (spawnPower <= 0) return; // termination guard
  for (let l = 0; l < LANES; l++) {
    if (l === myLane) continue;
    const cell = nearestEmptyCell(state, l as LaneIndex, card.owner);
    if (cell === null) continue; // lane full → skip
    cloneInto(state, card, l as LaneIndex, cell, spawnPower, events);
  }
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
    // Immune/Guardian-protected card at the far edge: it stays, and it becomes a wall for the cards
    // behind it (a friendly Guardian in this lane shields owner cards exactly like Bedrock pushImmune).
    if (
      (dest < 0 || dest >= CELLS) &&
      (isPushImmune(occupant.def) || isGuardianProtected(state, lane, occupant))
    ) {
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

/**
 * Pass 2: Ocean buffs +amount onto EVERY card remaining in the owner's deck, then returns to the deck
 * itself at a seeded slot — carrying its own accumulated bonus grown by `amount` ("including itself").
 * Only the owner's deck is touched; the enemy's deck is never affected. A redrawn Ocean is therefore
 * stronger each cycle, and so is every other deck card it buffed.
 */
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

  const deck = state.players[o.owner].deck;
  // Buff every card still in the owner's deck by `amount`.
  for (const entry of deck) entry.bonus += o.amount;
  events.push({
    type: "ability",
    seat: o.owner,
    card: card.def,
    text: `gave +${o.amount} power to every card in the deck`,
  });

  cells[idx] = null;

  // Return to the deck carrying its own accumulated bonus, itself grown by `amount` ("including itself").
  const returned: DeckCard = { def: card.def, bonus: card.bonus + o.amount };
  const pos = deck.length === 0 ? 0 : Math.floor(rng() * (deck.length + 1));
  deck.splice(pos, 0, returned);
  events.push({
    type: "ability",
    seat: o.owner,
    card: card.def,
    text: "vanished into the deck",
  });
}

/**
 * A card instance's current power with NO lane context: base power plus its accumulated `bonus`,
 * floored at 0. Use this wherever a CardInstance is DISPLAYED off the board — in hand, in the pick
 * menu, in a hand list — where lane doubling does not apply. On-board power (which also applies a
 * friendly `laneDouble`) comes from `effectivePower(state, lane, card)` instead.
 */
export const instancePower = (card: CardInstance): number =>
  Math.max(0, card.def.power + card.bonus);

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
      reason: "over" | "not-in-hand" | "energy" | "anchored" | "blocked";
    };

export function canPlay(
  state: GameState,
  uid: number,
  lane: LaneIndex,
): PlayCheck {
  if (state.winner) return { ok: false, reason: "over" };
  // Frozen's lock: while active, NEITHER seat may play any card this turn.
  if (state.turnLock > 0) return { ok: false, reason: "blocked" };
  const player = state.players[state.active];
  const card = player.hand.find((c) => c.uid === uid);
  if (!card) return { ok: false, reason: "not-in-hand" };
  if (instanceCost(state, state.active, card) > player.energy)
    return { ok: false, reason: "energy" };
  // Vainglory: playable only while The Eyes Privilege favors the enemy (owner HP < enemy HP).
  if (hasContinuousKind(card.def, "vaingloryGate")) {
    const total = state.bottomStartHP + state.topStartHP;
    const ownerHP =
      state.active === "bottom" ? state.balance : total - state.balance;
    const enemyHP = total - ownerHP;
    if (!(ownerHP < enemyHP)) return { ok: false, reason: "blocked" };
  }
  const cells = state.lanes[lane];
  if (isAnchored(cells) && wouldPush(cells, state.active))
    return { ok: false, reason: "anchored" };
  // A push that a Bedrock (push-immune) at the far edge would absorb leaves no legal placement:
  // the played card can't enter and nothing moves, so forbid the lane entirely.
  if (wouldPush(cells, state.active) && pushAbsorbed(cells, state.active))
    return { ok: false, reason: "blocked" };
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

/*
 * MOVE-EVENT CONVENTION (design D.4). EVERY positional displacement of an on-board card — a push,
 * pull, swap/exchange, self-relocation, random hop, or lane-shift — emits one `moved` GameEvent for
 * each card whose (lane,cell) changes. A swap emits `moved` for BOTH cards. A clone-spawn (cloneInto)
 * does NOT move an existing card, so it emits `cloned`, not `moved`.
 *
 * Audit of existing movers: today only `moveCardToEmptyLane` (Phasing relocation) and `relocateCard`
 * (the end-of-turn movers below) emit per-card `moved` events. The push machinery — `pushInto` (entry
 * push), `sirenPush`, and `phantomPush` — rearranges cells WITHOUT emitting a per-card `moved` event;
 * each only pushes an `ability` log line. That emission behavior is left UNCHANGED on purpose: making
 * the pushers emit `moved` would alter the historical movement/push behavior and the push tests. The
 * reworked Wicked (self-only, +2 once at end of turn) only reacts to its OWN `moved` events, which now
 * come solely from the NEW end-of-turn movers (Wild/Titan/Apex), all of which DO emit `moved`.
 */

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

/**
 * Moves the on-board card at `from` into the KNOWN-EMPTY cell at `to`, preserving uid/owner/bonus, and
 * emits one `moved` event. Unlike `moveCardToEmptyLane` (which hard-codes the owner's entry cell and
 * assumes a wholly empty lane), this places into a specific cell the caller chose (via nearestEmptyCell).
 * precondition: `state.lanes[from.lane][from.cell]` holds the card and `state.lanes[to.lane][to.cell]`
 * is null. Backs the end-of-turn movers (Wild, Titan).
 */
function relocateCard(
  state: GameState,
  from: { lane: LaneIndex; cell: number },
  to: { lane: LaneIndex; cell: number },
  events: GameEvent[],
): void {
  const card = state.lanes[from.lane][from.cell]!;
  state.lanes[from.lane][from.cell] = null;
  state.lanes[to.lane][to.cell] = card;
  events.push({
    type: "moved",
    seat: card.owner,
    uid: card.uid,
    card: card.def,
    from,
    to,
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
  // Defensive guard: a Guardian-protected card should never reach destruction (the push machinery
  // walls it at the far edge). If one slips through, re-place it at its lane's far edge instead of
  // destroying — mirroring Bedrock's pushImmune. The far-edge cell it just fell from is empty.
  if (isGuardianProtected(state, fromLane, card)) {
    const farEdge = actor === "bottom" ? 0 : CELLS - 1;
    if (state.lanes[fromLane][farEdge] === null)
      state.lanes[fromLane][farEdge] = card;
    return false;
  }
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
  destroyCard(state, card, events, cause, fromLane, rng);
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
    // Immune/Guardian-protected card at the far edge: it stays, and it becomes a wall for the cards
    // behind it (a friendly Guardian in this lane shields owner cards exactly like Bedrock pushImmune).
    if (
      (dest < 0 || dest >= CELLS) &&
      (isPushImmune(occupant.def) || isGuardianProtected(state, lane, occupant))
    ) {
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
  // Charge the discounted cost (Gentle board + Ancient in-hand), the same value canPlay gated on.
  player.energy -= instanceCost(state, seat, card);

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
  if (ability?.timing === "onPlay") applyOnPlay(state, card, events);

  // Wicked no longer reacts per action. It is self-only and resolves at the owner's end of turn
  // (applyEndOfTurnAbilities), reading the turn's accumulated `moved` events (design D.5).

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
          // A card shielded by its own friendly Guardian in this lane is left in place (never the
          // enemy's — an enemy card has no owner-matching Guardian here, so it is still destroyed).
          if (isGuardianProtected(state, lane, occupant)) continue;
          cells[i] = null;
          destroyedNames.push(occupant.def.name);
          destroyCard(state, occupant, events, "laser", lane, rng);
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
      // Hand cards rejoin the deck as fresh entries (bonus discarded, as before); deck entries keep
      // their accumulated bonus. Board cards are untouched.
      const pool: DeckCard[] = [
        ...me.hand.map((c) => ({ def: c.def, bonus: 0 })),
        ...me.deck,
      ];
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
    case "cloneBoard": {
      const p = card.def.power + card.bonus; // Spectra's current power
      let n = 0;
      for (let l = 0; l < LANES; l++)
        for (let i = 0; i < CELLS; i++)
          if (state.lanes[l][i] === null) {
            cloneInto(state, card, l as LaneIndex, i, p, events);
            n += 1;
          }
      say(`spawned ${n} ${n === 1 ? "copy" : "copies"}`);
      break;
    }
    case "cloneLane": {
      const p = card.def.power + card.bonus;
      let n = 0;
      for (let i = 0; i < CELLS; i++)
        if (state.lanes[lane][i] === null) {
          cloneInto(state, card, lane, i, p, events);
          n += 1;
        }
      say(`spawned ${n} ${n === 1 ? "copy" : "copies"}`);
      break;
    }
    case "cloneMirror": {
      // Only side lanes mirror. Lane 0 ↔ lane 2; the middle lane (1) does nothing.
      const other: LaneIndex | null = lane === 0 ? 2 : lane === 2 ? 0 : null;
      if (other === null) {
        say("found no side lane to mirror");
        break;
      }
      const p = card.def.power + card.bonus;
      // nearestEmptyCell starts the scan AT the owner's entry cell and moves inward, so it already
      // returns the entry cell when that cell is empty and the next-nearest toward the owner otherwise.
      const target = nearestEmptyCell(state, other, seat);
      if (target === null) {
        say("found no room to mirror");
        break;
      }
      cloneInto(state, card, other, target, p, events);
      say("spawned a copy in the other lane");
      break;
    }
    case "nexusSum": {
      if (lane !== 1) {
        say("found no neighbors to draw from");
        break;
      }
      // Nexus's row = its own cell index in the middle lane.
      const row = state.lanes[1].findIndex((c) => c?.uid === card.uid);
      const neighbor = (l: LaneIndex): number => {
        const c = state.lanes[l][row];
        return c ? Math.max(0, c.def.power + c.bonus) : 0;
      };
      const gain = neighbor(0) + neighbor(2);
      card.bonus += gain;
      say(`gained ${gain} power from its neighbors`);
      break;
    }
    case "gentlePush":
    // Gentle's push is deferred to the owner's end of turn (applyGentlePush in resolveTurn); it does
    // nothing on play. This case keeps the active switch exhaustive for assertNever.
    // fallthrough: the five end-of-turn movers below behave the same way — no-op on play, resolved in
    // applyEndOfTurnAbilities during the owner's end of turn.
    case "watcherDig":
    case "moonlitSacrifice":
    case "titanShift":
    case "apexSwap":
    case "berserkKill":
    // The five summon/buff actives below are also no-ops on play; they resolve during the owner's
    // end-of-turn pass (wiring lands in FEAT-002). Listed here to keep the active switch exhaustive.
    case "summonHand":
    case "summonDeck":
    case "vaporSummon":
    case "chronosSummon":
    case "evilHighest":
    // The nine new actives below are also no-ops on play; they resolve during the owner's end-of-turn
    // pass (applyEndOfTurnAbilities). Listed here to keep the active switch exhaustive for assertNever.
    case "joyfulBuff":
    case "goliathGain":
    case "frozenLock":
    case "gloomLane":
    case "sunkenPull":
    case "killingDeck":
    case "numbDeck":
    case "sunlitScatter":
      break;
    default:
      assertNever(effect);
  }
}

/**
 * Runs an `onPlay` passive once at play time for the PLAYED card only (clones are placed, never
 * played, so a cloned onPlay card never re-fires). Doran's `earlyBuff`: if the current turn is within
 * `byTurn`, add `amount` permanent power.
 */
function applyOnPlay(
  state: GameState,
  card: CardInstance,
  events: GameEvent[],
): void {
  const ability = card.def.ability!;
  if (ability.timing !== "onPlay") return;
  const effect = ability.effect;
  // OnPlayEffect has a single kind (earlyBuff). TS 7 does not narrow a single-member discriminated
  // type to `never`, so `assertNever` cannot cap this switch; the typed `effect.kind` literal still
  // forces any future kind to be handled here.
  if (effect.kind === "earlyBuff") {
    // The turn the player sees, pinned to the renderer's expression.
    const turn = Math.min(
      state.turnsPlayed + (state.winner ? 0 : 1),
      MAX_TURNS,
    );
    if (turn <= effect.byTurn) {
      card.bonus += effect.amount;
      events.push({
        type: "ability",
        seat: card.owner,
        card: card.def,
        text: `gained +${effect.amount} power for an early play`,
      });
    }
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

/**
 * Cosmic (endOfRound teamBuffEndOfTurn): at every end of turn, each on-board Cosmic gives +amount
 * power to every OTHER card of ITS OWN owner on the board (not the enemy, not itself, not other
 * Cosmics' effect on itself). Multiple Cosmics stack per the generic scan. Seat-scoped by owner.
 */
function applyCosmicBuff(state: GameState, events: GameEvent[]): void {
  for (let lane = 0; lane < LANES; lane++)
    for (let i = 0; i < CELLS; i++) {
      const cosmic = state.lanes[lane][i];
      const ab = cosmic?.def.ability;
      if (
        !cosmic ||
        ab?.timing !== "endOfRound" ||
        ab.effect.kind !== "teamBuffEndOfTurn"
      )
        continue;
      const amount = ab.effect.amount;
      let n = 0;
      for (let l = 0; l < LANES; l++)
        for (let j = 0; j < CELLS; j++) {
          const other = state.lanes[l][j];
          if (
            other &&
            other.owner === cosmic.owner &&
            other.uid !== cosmic.uid
          ) {
            other.bonus += amount;
            n += 1;
          }
        }
      events.push({
        type: "ability",
        seat: cosmic.owner,
        card: cosmic.def,
        text: `gave +${amount} power to ${n} allied card${n === 1 ? "" : "s"}`,
      });
    }
}

/**
 * Gentle's end-of-turn push, for the seat that just ended its turn (`state.active`). For each on-board
 * Gentle (`active` timing, `gentlePush` effect) owned by that seat, count the owner's friendly on-board
 * cards with `kind: "passive"` (Gentle is `kind: "active"`, so it never counts itself), snapshot the
 * enemy side's current remaining HP, and push the meter `percent`% of that snapshot toward the enemy
 * per passive card. Benefits the owner (bottom → + balance, top → − balance). Clamps to [0, total] and
 * emits a tide_shifted event so the log shows it. Zero friendly passives → no push, no event. Re-checks
 * knockout afterward so a Gentle push can win.
 */
function applyGentlePush(state: GameState, events: GameEvent[]): void {
  const owner = state.active;
  const total = state.bottomStartHP + state.topStartHP;
  const board = cardsOnBoard(state);
  const gentles = board.filter((c) => {
    const ab = c.def.ability;
    return (
      c.owner === owner &&
      ab?.timing === "active" &&
      ab.effect.kind === "gentlePush"
    );
  });
  if (gentles.length === 0) return;

  const passiveCount = board.filter(
    (c) => c.owner === owner && c.def.kind === "passive",
  ).length;
  if (passiveCount === 0) return; // nothing to push

  for (const gentle of gentles) {
    const ab = gentle.def.ability!;
    if (ab.timing !== "active" || ab.effect.kind !== "gentlePush") continue; // narrow
    const percent = ab.effect.percent;
    // Snapshot the enemy's current HP once; `percent`% of it per passive card is the push.
    const enemyHP = owner === "bottom" ? total - state.balance : state.balance;
    const push = passiveCount * Math.round((percent / 100) * enemyHP);
    if (push === 0) continue;
    const signed = owner === "bottom" ? push : -push;
    const before = state.balance;
    state.balance = Math.max(0, Math.min(total, before + signed));
    const applied = state.balance - before;
    events.push({
      type: "tide_shifted",
      delta: applied,
      rawDelta: signed,
      balance: state.balance,
      turn: state.turnsPlayed,
    });
    // A Gentle push can reach an edge and win.
    if (state.balance >= total) finish(state, "bottom", "balance", events);
    else if (state.balance <= 0) finish(state, "top", "balance", events);
    if (state.winner) return;
  }
}

/** The effective power of an on-board card or deck entry: base + its accumulated bonus, floored at 0. */
const effectivePowerOf = (def: CardDef, bonus: number): number =>
  Math.max(0, def.power + bonus);

/**
 * Central destroy tally for cards destroyed OFF the board (in hand or in the deck), where destroyCard
 * does not run. Adds the card's effective power (floored at 0, same as destroyCard's board tally) to
 * `destroyedPower` and increments `destroyedCount`, so Stella grows from hand/deck destruction too.
 */
export function tallyDestroyed(
  state: GameState,
  def: CardDef,
  bonus: number,
): void {
  state.destroyedPower += effectivePowerOf(def, bonus);
  state.destroyedCount += 1;
}

/**
 * Distributes an integer `total` across `targets` one point at a time: `total` iterations, each adding
 * +1 permanent power (`bonus`) to a uniformly-random target via the seeded `pick`. Empty target list
 * or `total <= 0` → nothing happens and the power is lost. Returns the amount actually distributed
 * (`total` when spread, else 0). The helper is event-free so each caller words its own log line.
 */
export function spreadPowerRandomly(
  targets: CardInstance[],
  total: number,
  rng: Rng,
): number {
  if (targets.length === 0 || total <= 0) return 0;
  for (let i = 0; i < total; i++) pick(targets, rng).bonus += 1;
  return total;
}

/** Finds an on-board card by uid, returning its lane/cell/instance, or null if it has left the board. */
function findOnBoard(
  state: GameState,
  uid: number,
): { lane: LaneIndex; cell: number; card: CardInstance } | null {
  for (let lane = 0; lane < LANES; lane++)
    for (let cell = 0; cell < CELLS; cell++) {
      const card = state.lanes[lane][cell];
      if (card && card.uid === uid)
        return { lane: lane as LaneIndex, cell, card };
    }
  return null;
}

/** The two lanes other than `lane`, in ascending order. Always length 2. */
const otherLanes = (lane: LaneIndex): LaneIndex[] =>
  ([0, 1, 2] as LaneIndex[]).filter((l) => l !== lane);

/**
 * Watcher's (watcherDig): looks at the owner's top-3 deck entries WITHOUT revealing them and draws
 * exactly one into hand by Watcher's current lane — LEFT(0) → weakest, CENTER(1) → middle, RIGHT(2) →
 * strongest, by effective power (def.power + entry.bonus). Non-chosen entries stay in their original
 * top order (no shuffle). Edge cases: 1 entry → that one; 2 entries → left=lower, right=higher,
 * center=the lower. Drawn card respects MAX_HAND (a full hand burns it, mirroring draw()).
 */
function applyWatcherDig(
  state: GameState,
  watcher: CardInstance,
  lane: LaneIndex,
  events: GameEvent[],
): void {
  const deck = state.players[watcher.owner].deck;
  const topCount = Math.min(3, deck.length);
  if (topCount === 0) return; // empty deck → nothing
  // Candidates = the top `topCount` entries, tagged with their deck index and effective power.
  const candidates = deck.slice(0, topCount).map((entry, idx) => ({
    idx,
    power: effectivePowerOf(entry.def, entry.bonus),
  }));
  // Order by power ascending, breaking ties by original top order (stable: lower idx first).
  const byPower = [...candidates].sort((a, b) =>
    a.power === b.power ? a.idx - b.idx : a.power - b.power,
  );
  // Pick position by lane: left → weakest (0), right → strongest (last), center → middle.
  // Per the task's 2-card rule, center resolves to the lower of the two (floor of the midpoint).
  const pos =
    lane === 0
      ? 0
      : lane === 2
        ? byPower.length - 1
        : Math.floor((byPower.length - 1) / 2);
  const chosenDeckIdx = byPower[pos].idx;
  const [entry] = deck.splice(chosenDeckIdx, 1); // non-chosen entries keep their order
  if (handFull(state, watcher.owner)) {
    events.push({ type: "burned", seat: watcher.owner, card: entry.def });
    events.push({
      type: "ability",
      seat: watcher.owner,
      card: watcher.def,
      text: "dug a card from the deck, but the hand was full",
    });
    return;
  }
  const drawn: CardInstance = {
    uid: state.nextUid++,
    def: entry.def,
    owner: watcher.owner,
    bonus: entry.bonus,
  };
  state.players[watcher.owner].hand.push(drawn);
  events.push({
    type: "drew",
    seat: watcher.owner,
    uid: drawn.uid,
    card: entry.def,
  });
  events.push({
    type: "ability",
    seat: watcher.owner,
    card: watcher.def,
    // Do NOT reveal the non-chosen cards; name only the drawn one.
    text: `dug ${entry.def.name} from the top of the deck`,
  });
}

/**
 * Moonlit (moonlitSacrifice): destroys ALL cards in the owner's hand (each feeds Stella via
 * tallyDestroyed — hand destruction now grows destroyedPower/destroyedCount), sums their effective
 * power, and spreads that total RANDOMLY across ALL of the owner's on-board cards (Moonlit itself
 * eligible), one point at a time. Empty hand → nothing, no event. Empty board → power lost.
 */
function applyMoonlitSacrifice(
  state: GameState,
  moonlit: CardInstance,
  events: GameEvent[],
  rng: Rng,
): void {
  const hand = state.players[moonlit.owner].hand;
  if (hand.length === 0) return;
  const total = hand.reduce((n, c) => n + effectivePowerOf(c.def, c.bonus), 0);
  for (const c of hand) tallyDestroyed(state, c.def, c.bonus); // hand destroys now feed Stella
  state.players[moonlit.owner].hand = [];
  const friendly: CardInstance[] = [];
  for (let lane = 0; lane < LANES; lane++)
    for (let cell = 0; cell < CELLS; cell++) {
      const c = state.lanes[lane][cell];
      if (c && c.owner === moonlit.owner) friendly.push(c);
    }
  const spread = spreadPowerRandomly(friendly, total, rng);
  events.push({
    type: "ability",
    seat: moonlit.owner,
    card: moonlit.def,
    text: `destroyed its hand and spread ${spread} power across your cards`,
  });
}

/**
 * Titan (titanShift): moves every OTHER card in Titan's lane (both seats, Titan excluded) into ONE
 * RANDOM other lane, each into the empty cell nearest THAT card's owner side; moves as many as fit,
 * the rest stay (no destruction). Titan does not move. Each relocated card emits `moved`.
 */
function applyTitanShift(
  state: GameState,
  titan: CardInstance,
  lane: LaneIndex,
  events: GameEvent[],
  rng: Rng,
): void {
  const dest = pick(otherLanes(lane), rng);
  // Collect the other cards in Titan's lane top→bottom (deterministic placement order).
  const movers: { cell: number; card: CardInstance }[] = [];
  for (let cell = 0; cell < CELLS; cell++) {
    const c = state.lanes[lane][cell];
    if (c && c.uid !== titan.uid) movers.push({ cell, card: c });
  }
  let moved = 0;
  for (const m of movers) {
    const toCell = nearestEmptyCell(state, dest, m.card.owner);
    if (toCell === null) continue; // destination full for this owner side → stays
    relocateCard(
      state,
      { lane, cell: m.cell },
      { lane: dest, cell: toCell },
      events,
    );
    moved += 1;
  }
  if (moved > 0)
    events.push({
      type: "ability",
      seat: titan.owner,
      card: titan.def,
      text: `shifted ${moved} card${moved === 1 ? "" : "s"} to the ${LANE_NAMES[dest]} lane`,
    });
}

/**
 * Apex (apexSwap): in Apex's lane, finds the OWNER's friendly card closest to the ENEMY edge (bottom
 * owner → smallest cell index; top owner → largest), and swaps cells with it. If Apex is already that
 * frontmost card, or it is the owner's only friendly card in the lane, nothing happens. The swap emits
 * `moved` for BOTH cards.
 */
function applyApexSwap(
  state: GameState,
  apex: CardInstance,
  lane: LaneIndex,
  apexCell: number,
  events: GameEvent[],
): void {
  const cells = state.lanes[lane];
  // Enemy edge: bottom's is cell 0, top's is cell CELLS-1. Scan toward the owner to find the frontmost
  // friendly card (first friendly starting from the enemy edge).
  const order =
    apex.owner === "bottom"
      ? Array.from({ length: CELLS }, (_, i) => i) // 0,1,2
      : Array.from({ length: CELLS }, (_, i) => CELLS - 1 - i); // 2,1,0
  let frontCell: number | null = null;
  for (const i of order) {
    const c = cells[i];
    if (c && c.owner === apex.owner) {
      frontCell = i;
      break;
    }
  }
  if (frontCell === null || frontCell === apexCell) return; // Apex is already frontmost / only card
  const front = cells[frontCell]!;
  // Swap the two cells and emit a `moved` for each displaced card.
  cells[apexCell] = front;
  cells[frontCell] = apex;
  events.push({
    type: "moved",
    seat: apex.owner,
    uid: apex.uid,
    card: apex.def,
    from: { lane, cell: apexCell },
    to: { lane, cell: frontCell },
  });
  events.push({
    type: "moved",
    seat: front.owner,
    uid: front.uid,
    card: front.def,
    from: { lane, cell: frontCell },
    to: { lane, cell: apexCell },
  });
  events.push({
    type: "ability",
    seat: apex.owner,
    card: apex.def,
    text: `swapped places with ${front.def.name}`,
  });
}

/**
 * Berserk (berserkKill): destroys the card in the cell directly IN FRONT of Berserk (one step toward
 * the enemy edge: bottom → cell−1, top → cell+1), friendly OR enemy, routed through destroyCard so
 * onDestroy (Phoenix/Glacial) and the destroyedPower/destroyedCount tallies apply. Empty front → nothing.
 */
function applyBerserkKill(
  state: GameState,
  berserk: CardInstance,
  lane: LaneIndex,
  berserkCell: number,
  events: GameEvent[],
  rng: Rng,
): void {
  const step = berserk.owner === "bottom" ? -1 : 1;
  const frontCell = berserkCell + step;
  if (frontCell < 0 || frontCell >= CELLS) return; // Berserk is at the enemy edge → no cell in front
  const victim = state.lanes[lane][frontCell];
  if (!victim) return; // empty front → nothing
  // A victim shielded by its own friendly Guardian in this lane survives (enemy victims are not).
  if (isGuardianProtected(state, lane, victim)) return;
  state.lanes[lane][frontCell] = null;
  // "laser" cause: a direct destroy (not a push/siren), so Glacial's push-only spawn does not fire.
  destroyCard(state, victim, events, "laser", lane, rng);
  events.push({
    type: "ability",
    seat: berserk.owner,
    card: berserk.def,
    text: `destroyed ${victim.def.name} in front of it`,
  });
}

/**
 * Wild (wildShift): picks ONE RANDOM card in Wild's own lane excluding Wild (either seat) and moves it
 * to a RANDOM destination lane — among the two OTHER lanes that have an empty cell for that card's
 * owner side. If no other card is in the lane, or neither other lane has room, nothing happens. The
 * moved card emits `moved`.
 */
function applyWildShift(
  state: GameState,
  wild: CardInstance,
  lane: LaneIndex,
  events: GameEvent[],
  rng: Rng,
): void {
  const others: { cell: number; card: CardInstance }[] = [];
  for (let cell = 0; cell < CELLS; cell++) {
    const c = state.lanes[lane][cell];
    if (c && c.uid !== wild.uid) others.push({ cell, card: c });
  }
  if (others.length === 0) return; // no other card to move
  const chosen = pick(others, rng);
  // Candidate destination lanes: the other two lanes that have room for the chosen card's owner.
  const dests = otherLanes(lane).filter(
    (l) => nearestEmptyCell(state, l, chosen.card.owner) !== null,
  );
  if (dests.length === 0) return; // neither other lane has room
  const dest = pick(dests, rng);
  const toCell = nearestEmptyCell(state, dest, chosen.card.owner)!;
  relocateCard(
    state,
    { lane, cell: chosen.cell },
    { lane: dest, cell: toCell },
    events,
  );
  events.push({
    type: "ability",
    seat: wild.owner,
    card: wild.def,
    text: `moved ${chosen.card.def.name} to the ${LANE_NAMES[dest]} lane`,
  });
}

/**
 * Mortal (summonHand): at the owner's end of turn, summons a RANDOM card from the owner's hand into the
 * cell directly in front of Mortal (toward the enemy edge). No-op when Mortal is at the enemy edge (no
 * front cell), the front cell is occupied, or the hand is empty. The summoned card fires its ability
 * via summonInto, exactly like a played card.
 */
function applyMortalSummon(
  state: GameState,
  mortal: CardInstance,
  lane: LaneIndex,
  cell: number,
  events: GameEvent[],
  rng: Rng,
): void {
  const front = frontCell(mortal.owner, cell);
  if (front < 0 || front >= CELLS) return; // Mortal is at the enemy edge → no cell in front
  if (state.lanes[lane][front] !== null) return; // front occupied → no-op
  const hand = state.players[mortal.owner].hand;
  if (hand.length === 0) return; // empty hand → no-op
  const picked = pick(hand, rng);
  const idx = hand.findIndex((c) => c.uid === picked.uid);
  hand.splice(idx, 1);
  const fires = { n: 0 };
  summonInto(
    state,
    mortal,
    picked.def,
    picked.bonus,
    lane,
    front,
    events,
    rng,
    fires,
  );
}

/**
 * Omen (summonDeck): same as Mortal but pulls a RANDOM entry from the owner's DECK (carrying the deck
 * entry's accumulated bonus) into the front cell. No-op when at the enemy edge, the front cell is
 * occupied, or the deck is empty.
 */
function applyOmenSummon(
  state: GameState,
  omen: CardInstance,
  lane: LaneIndex,
  cell: number,
  events: GameEvent[],
  rng: Rng,
): void {
  const front = frontCell(omen.owner, cell);
  if (front < 0 || front >= CELLS) return; // at the enemy edge → no cell in front
  if (state.lanes[lane][front] !== null) return; // front occupied → no-op
  const deck = state.players[omen.owner].deck;
  if (deck.length === 0) return; // empty deck → no-op
  const picked = pick(deck, rng);
  const idx = deck.findIndex((e) => e === picked);
  deck.splice(idx, 1);
  const fires = { n: 0 };
  summonInto(
    state,
    omen,
    picked.def,
    picked.bonus,
    lane,
    front,
    events,
    rng,
    fires,
  );
}

/**
 * Vapor (vaporSummon, design D5): at the owner's end of turn Vapor VANISHES — it is removed directly
 * from its cell (NOT routed through destroyCard, so it never touches destroyedPower/destroyedCount and
 * never fires onDestroy) — then summons a RANDOM deck card whose base cost is strictly GREATER than
 * Vapor's current effective cost (base 4) into Vapor's just-vacated cell, carrying that deck entry's
 * bonus. No higher-cost deck card → Vapor simply vanished (a "vanished" line, no summon).
 */
function applyVaporSummon(
  state: GameState,
  vapor: CardInstance,
  lane: LaneIndex,
  cell: number,
  events: GameEvent[],
  rng: Rng,
): void {
  const owner = vapor.owner;
  const vaporCost = effectiveCost(state, owner, vapor.def);
  // Direct removal — a disappearance, not a destroy (no tally, no onDestroy).
  state.lanes[lane][cell] = null;
  const deck = state.players[owner].deck;
  const candidates = deck.filter((e) => e.def.cost > vaporCost);
  if (candidates.length === 0) {
    events.push({
      type: "ability",
      seat: owner,
      card: vapor.def,
      text: "vanished",
    });
    return;
  }
  const picked = pick(candidates, rng);
  const idx = deck.findIndex((e) => e === picked);
  deck.splice(idx, 1);
  const fires = { n: 0 };
  summonInto(
    state,
    vapor,
    picked.def,
    picked.bonus,
    lane,
    cell,
    events,
    rng,
    fires,
  );
}

/**
 * Chronos (chronosSummon, design D3) — resolves over two of the owner's end-of-turns:
 * - Turn A (no `pending`): destroys the HIGHEST effective-cost card in the owner's hand (ties broken
 *   randomly). The destroyed hand card feeds Stella (tallyDestroyed), and it is recorded as `pending`
 *   to summon at the end of the owner's NEXT turn. Empty hand → no-op.
 * - Turn B (`pending` set and the owner's turn counter has advanced): if Chronos is still alive (it is,
 *   since pass 2 re-found it live), summons the pending card into Chronos's CURRENT front cell (no-op if
 *   at the enemy edge or the front cell is occupied). Clears `pending` regardless of whether it placed.
 * If Chronos is destroyed before turn B, pass 2 never re-finds it and `pending` is lost with it.
 */
function applyChronosSummon(
  state: GameState,
  chronos: CardInstance,
  lane: LaneIndex,
  cell: number,
  events: GameEvent[],
  rng: Rng,
): void {
  const owner = chronos.owner;
  if (chronos.pending === undefined) {
    // Turn A: destroy the highest-cost hand card.
    const hand = state.players[owner].hand;
    if (hand.length === 0) return; // empty hand → no-op
    const maxCost = Math.max(
      ...hand.map((c) => effectiveCost(state, owner, c.def)),
    );
    const topCost = hand.filter(
      (c) => effectiveCost(state, owner, c.def) === maxCost,
    );
    const removed = pick(topCost, rng);
    const idx = hand.findIndex((c) => c.uid === removed.uid);
    hand.splice(idx, 1);
    tallyDestroyed(state, removed.def, removed.bonus); // hand destroy now feeds Stella
    chronos.pending = {
      def: removed.def,
      fireOnTurn: state.players[owner].turns + 1,
    };
    events.push({
      type: "ability",
      seat: owner,
      card: chronos.def,
      text: `destroyed ${removed.def.name} from its hand`,
    });
    return;
  }
  // Turn B: fire only once the owner's turn counter has advanced past the arming turn.
  if (state.players[owner].turns < chronos.pending.fireOnTurn) return;
  const pendingDef = chronos.pending.def;
  chronos.pending = undefined; // clear regardless of whether the summon places
  const front = frontCell(owner, cell);
  if (front < 0 || front >= CELLS) return; // at the enemy edge → no cell in front
  if (state.lanes[lane][front] !== null) return; // front occupied → no-op
  const fires = { n: 0 };
  summonInto(state, chronos, pendingDef, 0, lane, front, events, rng, fires);
}

/**
 * Evil (evilHighest, design D7): among ALL of the owner's cards on the board INCLUDING Evil itself,
 * finds the maximum base `def.cost`; every owner card whose base cost equals that maximum gains power
 * equal to that cost (permanent). Uses base cost per the task example (two 8-cost cards each gain +8).
 */
function applyEvilHighest(
  state: GameState,
  evil: CardInstance,
  events: GameEvent[],
): void {
  const owner = evil.owner;
  const mine: CardInstance[] = [];
  for (let l = 0; l < LANES; l++)
    for (let i = 0; i < CELLS; i++) {
      const c = state.lanes[l][i];
      if (c && c.owner === owner) mine.push(c);
    }
  if (mine.length === 0) return; // defensive: Evil itself should always qualify
  const maxCost = Math.max(...mine.map((c) => c.def.cost));
  let buffed = 0;
  for (const c of mine)
    if (c.def.cost === maxCost) {
      c.bonus += maxCost;
      buffed += 1;
    }
  events.push({
    type: "ability",
    seat: owner,
    card: evil.def,
    text: `gave +${maxCost} power to ${buffed} highest-cost card${buffed === 1 ? "" : "s"}`,
  });
}

/** Collects every on-board card owned by `owner`, lanes L→R, cells top→bottom (deterministic order). */
function ownerBoardCards(state: GameState, owner: Seat): CardInstance[] {
  const out: CardInstance[] = [];
  for (let lane = 0; lane < LANES; lane++)
    for (let cell = 0; cell < CELLS; cell++) {
      const c = state.lanes[lane][cell];
      if (c && c.owner === owner) out.push(c);
    }
  return out;
}

/**
 * Joyful (joyfulBuff): at the owner's end of turn, +1 permanent power to EVERY friendly on-board card
 * (Joyful included). Enemies untouched.
 */
function applyJoyfulBuff(
  state: GameState,
  joyful: CardInstance,
  events: GameEvent[],
): void {
  const mine = ownerBoardCards(state, joyful.owner);
  for (const c of mine) c.bonus += 1;
  events.push({
    type: "ability",
    seat: joyful.owner,
    card: joyful.def,
    text: `gave +1 power to ${mine.length} card${mine.length === 1 ? "" : "s"}`,
  });
}

/**
 * Goliath (goliathGain): at the owner's end of turn, gain permanent power
 * `round(10 * (1 - ownerRemainingHP/total))` clamped to 0..10, from the OWNER's perspective. The more
 * The Eyes Privilege favors the enemy (owner HP low), the more power. Seat-correct: ownerRemainingHP is
 * `balance` for bottom, `total - balance` for top.
 */
function applyGoliathGain(
  state: GameState,
  goliath: CardInstance,
  events: GameEvent[],
): void {
  const total = state.bottomStartHP + state.topStartHP;
  const ownerHP =
    goliath.owner === "bottom" ? state.balance : total - state.balance;
  // Floor matches BOTH of the user's worked examples: 15/100 → floor(8.5) = 8 and 99/100 → floor(0.1)
  // = 0 (Math.round would give 9 for the first, contradicting the spec's stated result of 8).
  const gain = Math.max(
    0,
    Math.min(10, Math.floor(10 * (1 - ownerHP / total))),
  );
  goliath.bonus += gain;
  events.push({
    type: "ability",
    seat: goliath.owner,
    card: goliath.def,
    text: `gained ${gain} power from The Eyes Privilege`,
  });
}

/** Frozen (frozenLock): at the owner's end of turn, lock BOTH players out of playing for two upcoming plies. */
function applyFrozenLock(
  state: GameState,
  frozen: CardInstance,
  events: GameEvent[],
): void {
  // Lock the next two plies: the opponent's next turn AND the owner's own next turn.
  // Frozen resolves inside resolveTurn (owner's end of turn), BEFORE control passes. startTurn
  // decrements once per turn start, so set 3 here: opponent startTurn 3→2 (locked), owner
  // startTurn 2→1 (locked), then the following opponent startTurn 1→0 clears it.
  state.turnLock = 3;
  events.push({
    type: "ability",
    seat: frozen.owner,
    card: frozen.def,
    text: "froze the board — no cards can be played next turn",
  });
}

/**
 * Gloom (gloomLane): at the owner's end of turn, every ENEMY card in Gloom's lane loses 1 permanent
 * power (bonus -= 1; effective power floors at 0 at read time). Friendlies and other lanes untouched.
 */
function applyGloomLane(
  state: GameState,
  gloom: CardInstance,
  lane: LaneIndex,
  events: GameEvent[],
): void {
  let hit = 0;
  for (let cell = 0; cell < CELLS; cell++) {
    const c = state.lanes[lane][cell];
    if (c && c.owner !== gloom.owner) {
      c.bonus -= 1;
      hit += 1;
    }
  }
  events.push({
    type: "ability",
    seat: gloom.owner,
    card: gloom.def,
    text: `drained 1 power from ${hit} enemy card${hit === 1 ? "" : "s"} in this lane`,
  });
}

/**
 * Pulls one `lane` a single step TOWARD `owner`'s near edge — the mirror of sirenPush (which shoves
 * toward the far edge). Direction in cell-index terms: bottom owner → step +1 (toward cell 2), top
 * owner → step -1 (toward cell 0). Visits cells NEAR-edge-first so each card slides into an
 * already-vacated slot. A push-immune / Guardian-protected card at the near edge is never destroyed:
 * it stays and walls the cards behind it. At most one non-immune card at the near edge is pulled off
 * and routed through resolvePushedOffCard (cause "siren"), so it tallies Stella, fires onDestroy, and
 * Guardian/pushImmune cards wall the pull. Emits a `moved` per shifted card.
 */
function pullLane(
  state: GameState,
  lane: LaneIndex,
  owner: Seat,
  events: GameEvent[],
  rng: Rng,
  fires: { n: number },
): void {
  const cells = state.lanes[lane];
  const step = owner === "bottom" ? 1 : -1; // toward the owner's near edge
  const nearEdge = entryCell(owner); // bottom → 2, top → 0
  // Visit near edge first, then inward, so each card moves into an already-vacated slot.
  const order: number[] = [];
  for (let k = 0; k < CELLS; k++) order.push(nearEdge - step * k);
  let destroyed: CardInstance | null = null;
  let blockedAt: number | null = null;
  for (const i of order) {
    const occupant = cells[i];
    if (!occupant) continue;
    const dest = i + step;
    if (
      (dest < 0 || dest >= CELLS) &&
      (isPushImmune(occupant.def) || isGuardianProtected(state, lane, occupant))
    ) {
      blockedAt = i;
      continue;
    }
    if (blockedAt !== null && dest === blockedAt) {
      blockedAt = i;
      continue;
    }
    if (dest < 0 || dest >= CELLS) {
      cells[i] = null;
      destroyed = occupant; // at most one card falls off a single-step pull
    } else {
      relocateCard(state, { lane, cell: i }, { lane, cell: dest }, events);
    }
  }
  if (destroyed)
    resolvePushedOffCard(
      state,
      destroyed,
      lane,
      owner,
      events,
      "siren",
      rng,
      fires,
    );
}

/**
 * Sunken (sunkenPull): at the owner's end of turn, PULL the two OTHER lanes (not Sunken's own) one step
 * toward the owner's near edge (mirror of Siren's push). A card at the owner's near edge pulled further
 * falls off and is destroyed. Sunken's own lane is untouched. Emits one summary `ability` line.
 */
function applySunkenPull(
  state: GameState,
  sunken: CardInstance,
  lane: LaneIndex,
  events: GameEvent[],
  rng: Rng,
): void {
  const fires = { n: 0 };
  for (const other of otherLanes(lane))
    pullLane(state, other, sunken.owner, events, rng, fires);
  events.push({
    type: "ability",
    seat: sunken.owner,
    card: sunken.def,
    text: "pulled the other two lanes toward you",
  });
}

/**
 * Killing (killingDeck): at the owner's end of turn, destroy ONE RANDOM card in the OPPONENT's deck.
 * The destroyed card feeds Stella (tallyDestroyed) and its NAME is written to the battle log. Empty
 * enemy deck → nothing.
 */
function applyKillingDeck(
  state: GameState,
  killing: CardInstance,
  events: GameEvent[],
  rng: Rng,
): void {
  const deck = state.players[opponentOf(killing.owner)].deck;
  if (deck.length === 0) return; // empty enemy deck → nothing
  const entry = pick(deck, rng);
  const idx = deck.findIndex((e) => e === entry);
  deck.splice(idx, 1);
  tallyDestroyed(state, entry.def, entry.bonus);
  events.push({
    type: "ability",
    seat: killing.owner,
    card: killing.def,
    text: `destroyed ${entry.def.name} from the enemy's deck`,
  });
}

/**
 * Numb (numbDeck): at the owner's end of turn, destroy ONE RANDOM card in the OWNER's OWN deck. Feeds
 * Stella (tallyDestroyed) and logs the destroyed card's name. Empty deck → nothing.
 */
function applyNumbDeck(
  state: GameState,
  numb: CardInstance,
  events: GameEvent[],
  rng: Rng,
): void {
  const deck = state.players[numb.owner].deck;
  if (deck.length === 0) return; // empty deck → nothing
  const entry = pick(deck, rng);
  const idx = deck.findIndex((e) => e === entry);
  deck.splice(idx, 1);
  tallyDestroyed(state, entry.def, entry.bonus);
  events.push({
    type: "ability",
    seat: numb.owner,
    card: numb.def,
    text: `destroyed ${entry.def.name} from your deck`,
  });
}

/**
 * Sunlit (sunlitScatter): at the owner's end of turn, Sunlit STAYS ALIVE and destroys every OTHER
 * friendly on-board card via destroyCard (so each tallies Stella and fires onDestroy — Phoenix rebirth,
 * Glacial spawn, Dispersed spread). Their summed effective power (read BEFORE destroying) is spread
 * randomly across the owner's HAND cards. Empty hand → power lost. Victims collected in deterministic
 * board order (lanes L→R, cells top→bottom).
 */
function applySunlitScatter(
  state: GameState,
  sunlit: CardInstance,
  events: GameEvent[],
  rng: Rng,
): void {
  // Collect victims (every other friendly board card) with their position and power-at-death.
  const victims: { lane: LaneIndex; cell: number; card: CardInstance }[] = [];
  for (let lane = 0; lane < LANES; lane++)
    for (let cell = 0; cell < CELLS; cell++) {
      const c = state.lanes[lane][cell];
      if (c && c.owner === sunlit.owner && c.uid !== sunlit.uid)
        victims.push({ lane: lane as LaneIndex, cell, card: c });
    }
  const fires = { n: 0 };
  let total = 0;
  for (const v of victims) {
    total += effectivePowerOf(v.card.def, v.card.bonus); // read BEFORE destroy
    state.lanes[v.lane][v.cell] = null;
    destroyCard(state, v.card, events, "laser", v.lane, rng);
  }
  const hand = state.players[sunlit.owner].hand;
  const spread = spreadPowerRandomly(hand, total, rng);
  events.push({
    type: "ability",
    seat: sunlit.owner,
    card: sunlit.def,
    text: `destroyed your other cards and spread ${spread} power across your hand`,
  });
}

/**
 * Flower (flowerBuff): a recurring passive — at the owner's end of turn, +1 permanent power to ONE
 * RANDOM friendly on-board card (Flower itself eligible). Empty (shouldn't happen; Flower qualifies) →
 * no-op.
 */
function applyFlowerBuff(
  state: GameState,
  flower: CardInstance,
  events: GameEvent[],
  rng: Rng,
): void {
  const mine = ownerBoardCards(state, flower.owner);
  if (mine.length === 0) return; // defensive: Flower itself should always qualify
  const target = pick(mine, rng);
  target.bonus += 1;
  events.push({
    type: "ability",
    seat: flower.owner,
    card: flower.def,
    text: `gave +1 power to ${target.def.name}`,
  });
}

/** The end-of-turn ability kind a card carries, if it is one the end-of-turn resolver handles. */
type EndOfTurnKind =
  | "watcherDig"
  | "moonlitSacrifice"
  | "titanShift"
  | "apexSwap"
  | "berserkKill"
  | "wildShift"
  | "summonHand"
  | "summonDeck"
  | "vaporSummon"
  | "chronosSummon"
  | "evilHighest"
  | "joyfulBuff"
  | "goliathGain"
  | "frozenLock"
  | "gloomLane"
  | "sunkenPull"
  | "killingDeck"
  | "numbDeck"
  | "sunlitScatter"
  | "flowerBuff";

function endOfTurnKindOf(def: CardDef): EndOfTurnKind | null {
  const ab = def.ability;
  if (!ab) return null;
  if (ab.timing === "active") {
    switch (ab.effect.kind) {
      case "watcherDig":
      case "moonlitSacrifice":
      case "titanShift":
      case "apexSwap":
      case "berserkKill":
      case "summonHand":
      case "summonDeck":
      case "vaporSummon":
      case "chronosSummon":
      case "evilHighest":
      case "joyfulBuff":
      case "goliathGain":
      case "frozenLock":
      case "gloomLane":
      case "sunkenPull":
      case "killingDeck":
      case "numbDeck":
      case "sunlitScatter":
        return ab.effect.kind;
      default:
        return null;
    }
  }
  if (ab.timing === "endOfRound" && ab.effect.kind === "wildShift")
    return "wildShift";
  if (ab.timing === "endOfRound" && ab.effect.kind === "flowerBuff")
    return "flowerBuff";
  return null;
}

/**
 * Resolves the end-of-turn board abilities for the seat that just ended its turn (`state.active`):
 * Watcher's dig, Moonlit sacrifice, Titan/Apex/Berserk, and the passive Wild shift. These were armed
 * by having been played earlier in the turn and deliberately deferred so a player cannot play, see the
 * random result, then reset the turn to re-roll (design D1).
 *
 * One collection pass first (lanes L→R, cells top→bottom) records each (uid, kind) to resolve; then
 * each is resolved by RE-FINDING the card by uid (skipping any that have since left the board). This
 * mirrors collectOceanReturns and avoids double-processing a card that an earlier mover relocated into
 * a not-yet-visited cell.
 *
 * The movers (Wild/Titan/Apex) run in this same pass BEFORE the Wicked end-of-turn check (design D5),
 * so Wicked sees its own `moved` events from them. Wicked's self-only +2 is applied afterward.
 */
function applyEndOfTurnAbilities(
  state: GameState,
  events: GameEvent[],
  rng: Rng,
): void {
  const owner = state.active;
  // Pass 1: collect this seat's end-of-turn carriers in deterministic board order.
  const todo: { uid: number; kind: EndOfTurnKind }[] = [];
  for (let lane = 0; lane < LANES; lane++)
    for (let cell = 0; cell < CELLS; cell++) {
      const card = state.lanes[lane][cell];
      if (!card || card.owner !== owner) continue;
      const kind = endOfTurnKindOf(card.def);
      if (kind) todo.push({ uid: card.uid, kind });
    }
  // Pass 2: resolve each by re-finding the card live (it may have moved or left the board).
  for (const t of todo) {
    const found = findOnBoard(state, t.uid);
    if (!found) continue; // left the board (e.g. destroyed by a Berserk earlier in the pass)
    const { lane, cell, card } = found;
    switch (t.kind) {
      case "watcherDig":
        applyWatcherDig(state, card, lane, events);
        break;
      case "moonlitSacrifice":
        applyMoonlitSacrifice(state, card, events, rng);
        break;
      case "titanShift":
        applyTitanShift(state, card, lane, events, rng);
        break;
      case "apexSwap":
        applyApexSwap(state, card, lane, cell, events);
        break;
      case "berserkKill":
        applyBerserkKill(state, card, lane, cell, events, rng);
        break;
      case "wildShift":
        applyWildShift(state, card, lane, events, rng);
        break;
      case "summonHand":
        applyMortalSummon(state, card, lane, cell, events, rng);
        break;
      case "summonDeck":
        applyOmenSummon(state, card, lane, cell, events, rng);
        break;
      case "vaporSummon":
        applyVaporSummon(state, card, lane, cell, events, rng);
        break;
      case "chronosSummon":
        applyChronosSummon(state, card, lane, cell, events, rng);
        break;
      case "evilHighest":
        applyEvilHighest(state, card, events);
        break;
      case "joyfulBuff":
        applyJoyfulBuff(state, card, events);
        break;
      case "goliathGain":
        applyGoliathGain(state, card, events);
        break;
      case "frozenLock":
        applyFrozenLock(state, card, events);
        break;
      case "gloomLane":
        applyGloomLane(state, card, lane, events);
        break;
      case "sunkenPull":
        applySunkenPull(state, card, lane, events, rng);
        break;
      case "killingDeck":
        applyKillingDeck(state, card, events, rng);
        break;
      case "numbDeck":
        applyNumbDeck(state, card, events, rng);
        break;
      case "sunlitScatter":
        applySunlitScatter(state, card, events, rng);
        break;
      case "flowerBuff":
        applyFlowerBuff(state, card, events, rng);
        break;
    }
  }
  // Wicked (self-only, +2 once per turn): after the movers above have run, bump each on-board Wicked
  // owned by this seat by exactly +2 if its OWN uid appears in a `moved` event emitted this turn.
  applyWickedEndOfTurn(state, owner, events);
  // Ancient (in-hand ancientDiscount): at the owner's end of turn, each Ancient still in hand accrues
  // +1 permanent cost reduction (applied live through instanceCost; floors the cost at 0).
  applyAncientDiscount(state, owner, events);
}

/**
 * Ancient (ancientDiscount, design D4): for the seat that just ended its turn, every card in its HAND
 * carrying the continuous `ancientDiscount` effect gains +1 accumulated `costReduction`. The reduction
 * is read live by instanceCost (floored at 0) at every instance-aware cost site. Emits one `ability`
 * line per Ancient so the log shows the discount ticking.
 */
function applyAncientDiscount(
  state: GameState,
  owner: Seat,
  events: GameEvent[],
): void {
  for (const card of state.players[owner].hand) {
    if (!hasContinuousKind(card.def, "ancientDiscount")) continue;
    card.costReduction = (card.costReduction ?? 0) + 1;
    events.push({
      type: "ability",
      seat: owner,
      card: card.def,
      text: "grew cheaper while waiting in hand",
    });
  }
}

/**
 * Wicked's end-of-turn resolution for `owner`: for each on-board Wicked owned by this seat, if its own
 * uid appears in any `moved` event accumulated in `events` this turn, add exactly +2 power ONCE (never
 * stacking per move). Runs AFTER the end-of-turn movers so their `moved` events are visible (design D5).
 */
function applyWickedEndOfTurn(
  state: GameState,
  owner: Seat,
  events: GameEvent[],
): void {
  const movedUids = new Set(
    events.filter((e) => e.type === "moved").map((e) => e.uid),
  );
  for (let lane = 0; lane < LANES; lane++)
    for (let cell = 0; cell < CELLS; cell++) {
      const c = state.lanes[lane][cell];
      if (
        c &&
        c.owner === owner &&
        hasContinuousKind(c.def, "wicked") &&
        movedUids.has(c.uid)
      ) {
        c.bonus += 2;
        events.push({
          type: "ability",
          seat: c.owner,
          card: c.def,
          text: "gained +2 power from moving this turn",
        });
      }
    }
}

function resolveTurn(state: GameState, events: GameEvent[], rng: Rng): void {
  // 1. Read board power -> 2. apply tide shift -> 3. bump turnsPlayed -> 4. knockout
  // -> 5. cap -> 6. end-of-turn passes (Gentle, Ocean), only if the game continues.
  const total = state.bottomStartHP + state.topStartHP;
  applyCosmicBuff(state, events); // Cosmic's +1 lands before the tide is read this turn
  const k = balanceFactor(state);
  const delta = (totalPower(state, "bottom") - totalPower(state, "top")) * k;
  const before = state.balance;
  state.balance = Math.max(0, Math.min(total, before + delta));
  events.push({
    type: "tide_shifted",
    delta: state.balance - before,
    rawDelta: delta,
    balance: state.balance,
    turn: state.turnsPlayed + 1,
  });
  state.turnsPlayed += 1;

  // Knockout: balance hits an edge (bottom's HP full / depleted).
  if (state.balance >= total) finish(state, "bottom", "balance", events);
  else if (state.balance <= 0) finish(state, "top", "balance", events);

  // Cap: run out of turns with no knockout -> whoever has more remaining HP wins.
  // Bottom's HP = balance, top's HP = total - balance.
  if (!state.winner && state.turnsPlayed >= MAX_TURNS) {
    const topHP = total - state.balance;
    finish(
      state,
      state.balance > topHP ? "bottom" : state.balance < topHP ? "top" : "draw",
      "turns",
      events,
    );
  }

  // Phase B: post-resolution end-of-turn effects, only if the game continues.
  // The board movers / draws / destroys (Watcher's, Moonlit, Wild, Titan, Apex, Berserk) and the
  // self-only Wicked bump resolve FIRST (design D3), so board mutations settle before the meter
  // pushes and Ocean's self-return read the board.
  if (!state.winner) applyEndOfTurnAbilities(state, events, rng);
  // A Berserk destroy can cross a transformAt threshold mid-end-of-turn; sweep so Bò SPD transforms.
  if (!state.winner) applyTransforms(state, events);
  if (!state.winner) applyGentlePush(state, events); // Gentle pushes the meter before Ocean
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

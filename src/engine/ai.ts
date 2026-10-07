import { pick, type Rng } from "../util/rng";
import { endTurn, legalPlays, playCard, totalPower, type Step } from "./rules";
import {
  opponentOf,
  type GameEvent,
  type GameState,
  type Play,
  type Seat,
} from "./types";

export type Difficulty = "easy" | "normal" | "hard";

/**
 * How good a position is for `me`. Board power counts triple because it is exactly what moves the
 * tide every turn; the tide position itself is a mild positional bias on top of that.
 */
export function evaluate(state: GameState, me: Seat): number {
  if (state.winner)
    return state.winner === me ? 1000 : state.winner === "draw" ? 0 : -1000;
  const foe = opponentOf(me);
  const mine = totalPower(state, me);
  const theirs = totalPower(state, foe);
  // Board power advantage is what moves the tide every turn, so weight it heavily.
  // Then nudge toward the tide already favouring `me`: higher balance helps bottom, lower helps top.
  const powerEdge = (mine - theirs) * 3;
  const tideEdge = me === "bottom" ? state.balance - 50 : 50 - state.balance;
  return powerEdge + tideEdge;
}

const costOf = (state: GameState, play: Play): number =>
  state.players[state.active].hand.find((c) => c.uid === play.uid)?.def.cost ??
  0;

/** Plans the active seat's whole turn (a list of plays) without ending it. */
export function chooseTurn(
  state: GameState,
  difficulty: Difficulty,
  rng: Rng,
): Play[] {
  if (difficulty === "easy") return planEasy(state, rng);
  if (difficulty === "normal") return planGreedy(state);
  return planBeam(state);
}

function planEasy(start: GameState, rng: Rng): Play[] {
  const plan: Play[] = [];
  let state = start;
  while (state.winner === null) {
    const options = legalPlays(state);
    if (options.length === 0 || rng() < 0.25) break;
    const play = pick(options, rng);
    plan.push(play);
    state = playCard(state, play.uid, play.lane).state;
  }
  return plan;
}

function planGreedy(start: GameState): Play[] {
  const me = start.active;
  const plan: Play[] = [];
  let state = start;
  while (state.winner === null) {
    const base = evaluate(state, me);
    let best: { play: Play; next: GameState; score: number } | null = null;
    for (const play of legalPlays(state)) {
      const next = playCard(state, play.uid, play.lane).state;
      // A small bonus for spending energy, so the bot does not sit on unused mana.
      const score = evaluate(next, me) - base + 0.25 * costOf(state, play);
      if (!best || score > best.score) best = { play, next, score };
    }
    if (!best || best.score <= 0) break;
    plan.push(best.play);
    state = best.next;
  }
  return plan;
}

/** Hard: keeps the 12 most promising partial turns at each step and returns the best whole turn it found. */
function planBeam(start: GameState): Play[] {
  const me = start.active;
  const WIDTH = 12;
  type Node = { state: GameState; plan: Play[]; value: number };
  let frontier: Node[] = [
    { state: start, plan: [], value: evaluate(start, me) },
  ];
  let best: Node = frontier[0];

  for (let depth = 0; depth < 12 && frontier.length > 0; depth++) {
    const next: Node[] = [];
    for (const node of frontier) {
      if (node.state.winner !== null) continue;
      for (const play of legalPlays(node.state)) {
        const state = playCard(node.state, play.uid, play.lane).state;
        next.push({
          state,
          plan: [...node.plan, play],
          value: evaluate(state, me),
        });
      }
    }
    next.sort((a, b) => b.value - a.value);
    frontier = next.slice(0, WIDTH);
    for (const node of frontier) if (node.value > best.value) best = node;
  }
  return best.plan;
}

/** Plays the active seat's turn with the AI and ends it. Returns every event that happened. */
export function playAiTurn(
  start: GameState,
  difficulty: Difficulty,
  rng: Rng,
): Step {
  const events: GameEvent[] = [];
  let state = start;
  for (const play of chooseTurn(state, difficulty, rng)) {
    const step = playCard(state, play.uid, play.lane);
    state = step.state;
    events.push(...step.events);
    if (state.winner) return { state, events };
  }
  const ended = endTurn(state, rng);
  return { state: ended.state, events: [...events, ...ended.events] };
}

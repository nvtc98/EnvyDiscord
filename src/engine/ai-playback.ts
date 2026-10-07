import type { Rng } from "../util/rng";
import { chooseTurn, type Difficulty } from "./ai";
import { describeEvents } from "./events";
import { endTurn, playCard } from "./rules";
import type { GameEvent, GameState, Seat } from "./types";

/**
 * One diegetic step of the opponent's turn: the engine state *after* this beat's events have been
 * applied (the board image is rendered from it) and the lines to show for it, already worded for
 * `viewer`. Hidden events (enemy draws, turn starts) yield an empty `lines` array; such beats are
 * kept so their resulting board state is available, but the animation loop skips the empty update.
 */
export interface Beat {
  state: GameState;
  lines: string[];
  /**
   * The engine events applied in THIS beat, in order. Populated by advanceAiBeats from the
   * step/end-turn events it already holds. Lets a consumer react per-beat (e.g. after-push).
   */
  events: readonly GameEvent[];
}

export interface AiPlayback {
  /** The authoritative state after the AI is done — identical to what `playAiTurn` would produce. */
  finalState: GameState;
  /** Ordered beats; some may have empty `lines`. */
  beats: Beat[];
  /** Every event in order, for logging (unchanged from the old whole-turn advance). */
  events: GameEvent[];
}

/**
 * Advances the AI exactly as the old whole-turn `advanceAi` did (loop while it is the opponent's
 * turn and the game is unfinished), but records each engine step as a beat so the caller can play
 * the turn back one beat at a time. It calls the same engine functions in the same order with the
 * same `rng`, so it consumes `rng` identically and ends in the same state. Pure; no timers.
 */
export function advanceAiBeats(
  start: GameState,
  difficulty: Difficulty,
  rng: Rng,
  viewer: Seat,
): AiPlayback {
  const beats: Beat[] = [];
  const events: GameEvent[] = [];
  let state = start;

  while (!state.winner && state.active === "top") {
    let turnOver = false;
    for (const play of chooseTurn(state, difficulty, rng)) {
      // One beat per AI card played, carrying any active-ability events from the same step.
      const step = playCard(state, play.uid, play.lane);
      state = step.state;
      events.push(...step.events);
      beats.push({
        state,
        lines: describeEvents(step.events, viewer),
        events: step.events,
      });
      if (state.winner) {
        turnOver = true;
        break;
      }
    }
    if (turnOver) break;
    // Per-turn resolution (the tide shift, end-of-turn Ocean passives, a possible game over) is its own beat.
    const ended = endTurn(state, rng);
    state = ended.state;
    events.push(...ended.events);
    beats.push({
      state,
      lines: describeEvents(ended.events, viewer),
      events: ended.events,
    });
  }

  return { finalState: state, beats, events };
}

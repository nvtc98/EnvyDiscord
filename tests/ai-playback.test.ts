import { describe, expect, it } from "vitest";
import { CARDS } from "../src/data/cards";
import { advanceAiBeats } from "../src/engine/ai-playback";
import { playAiTurn, type Difficulty } from "../src/engine/ai";
import { endTurn, newGame } from "../src/engine/rules";
import type { GameEvent, GameState } from "../src/engine/types";
import { mulberry32 } from "../src/util/rng";

/** The old whole-turn advance, reproduced here so we can prove the beat sequencer never desyncs. */
function wholeTurnAdvance(
  start: GameState,
  difficulty: Difficulty,
  rng: () => number,
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  let state = start;
  while (!state.winner && state.active === "top") {
    const step = playAiTurn(state, difficulty, rng);
    state = step.state;
    events.push(...step.events);
  }
  return { state, events };
}

/** Builds a game where the opponent (`top`) is on the move, so the sequencer has a turn to play. */
function aiToMove(seed: number): GameState {
  // `top` goes first, so right after newGame it is the opponent's turn.
  const game = newGame({ bottom: CARDS, top: CARDS }, "top", mulberry32(seed));
  return game.state;
}

const difficulties: Difficulty[] = ["easy", "normal", "hard"];

describe("advanceAiBeats", () => {
  it("ends in exactly the state the old whole-turn advance would, for every difficulty and seed", () => {
    for (const difficulty of difficulties) {
      for (let seed = 1; seed <= 12; seed++) {
        const start = aiToMove(seed);
        // Two freshly-seeded rngs give the same sequence; both advances consume it identically.
        const playback = advanceAiBeats(
          structuredClone(start),
          difficulty,
          mulberry32(seed + 7),
          "bottom",
        );
        const reference = wholeTurnAdvance(
          structuredClone(start),
          difficulty,
          mulberry32(seed + 7),
        );
        expect(playback.finalState).toEqual(reference.state);
        expect(playback.events).toEqual(reference.events);
      }
    }
  });

  it("produces at least one beat with visible lines when the AI plays a card", () => {
    for (const difficulty of difficulties) {
      let sawPlay = false;
      for (let seed = 1; seed <= 20 && !sawPlay; seed++) {
        const playback = advanceAiBeats(
          aiToMove(seed),
          difficulty,
          mulberry32(seed + 7),
          "bottom",
        );
        if (playback.events.some((e) => e.type === "played")) {
          sawPlay = true;
          const visible = playback.beats.filter((b) => b.lines.length > 0);
          expect(visible.length).toBeGreaterThanOrEqual(1);
        }
      }
      expect(sawPlay).toBe(true);
    }
  });

  it("emits a round-resolution beat when the opponent is the second player", () => {
    // `bottom` goes first; ending the human's turn hands over to the AI as the second player.
    // When the AI then ends its turn the round resolves, which must surface as its own beat.
    const game = newGame(
      { bottom: CARDS, top: CARDS },
      "bottom",
      mulberry32(3),
    );
    const afterHuman = endTurn(game.state); // now active === "top"
    expect(afterHuman.state.active).toBe("top");
    const playback = advanceAiBeats(
      afterHuman.state,
      "normal",
      mulberry32(99),
      "bottom",
    );
    const hasRoundBeat = playback.beats.some((b) =>
      b.lines.some((l) => /Round \d+ ends/.test(l)),
    );
    expect(hasRoundBeat).toBe(true);
  });

  it("keeps hidden events (enemy draws, turn starts) out of the visible lines", () => {
    const playback = advanceAiBeats(
      aiToMove(5),
      "normal",
      mulberry32(50),
      "bottom",
    );
    for (const beat of playback.beats) {
      for (const line of beat.lines) {
        expect(line).not.toMatch(/^The enemy drew/);
      }
    }
    // A real AI turn still contains hidden events (turn starts / enemy draws) in its event stream.
    const hidden = playback.events.filter(
      (e) =>
        e.type === "turn_started" || (e.type === "drew" && e.seat === "top"),
    );
    expect(hidden.length).toBeGreaterThan(0);
  });
});

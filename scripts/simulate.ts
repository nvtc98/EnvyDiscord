// Balance check: AI vs AI with random 12-card decks. Run with `npm run simulate`.
import { CARDS } from '../src/data/cards';
import { playAiTurn, type Difficulty } from '../src/engine/ai';
import { newGame } from '../src/engine/rules';
import type { GameState, Seat } from '../src/engine/types';
import { opponentDeck } from '../src/game/deck';
import { mulberry32 } from '../src/util/rng';

const GAMES = 200;

function play(bottom: Difficulty, top: Difficulty, seed: number) {
  const rng = mulberry32(seed);
  const first: Seat = seed % 2 === 0 ? 'bottom' : 'top'; // alternate who goes first
  let state: GameState = newGame({ bottom: opponentDeck(CARDS, rng), top: opponentDeck(CARDS, rng) }, first, rng).state;
  while (!state.winner) {
    const level = state.active === 'bottom' ? bottom : top;
    state = playAiTurn(state, level, rng).state;
  }
  return { winner: state.winner, rounds: state.round, firstWon: state.winner === first };
}

const matchups: [Difficulty, Difficulty][] = [
  ['easy', 'easy'],
  ['normal', 'easy'],
  ['hard', 'easy'],
  ['hard', 'normal'],
  ['normal', 'normal'],
  ['hard', 'hard'],
];

console.log('first vs second seat  | first-seat win% | draws | avg rounds | goes-first wins%');
console.log('(left level plays the bottom seat, right level the top seat; who moves first alternates)');
for (const [a, b] of matchups) {
  let wins = 0, draws = 0, rounds = 0, firstWins = 0;
  for (let seed = 1; seed <= GAMES; seed++) {
    const r = play(a, b, seed);
    if (r.winner === 'bottom') wins++;
    if (r.winner === 'draw') draws++;
    if (r.firstWon) firstWins++;
    rounds += r.rounds;
  }
  const pct = (n: number) => ((n / GAMES) * 100).toFixed(0).padStart(3);
  console.log(`${a.padEnd(7)} vs ${b.padEnd(7)} | ${pct(wins)}% (bottom wins) | ${pct(draws)}% | ${(rounds / GAMES).toFixed(1).padStart(6)} | ${pct(firstWins)}%`);
}

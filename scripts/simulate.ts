// Balance check: AI vs AI on random level-matched teams. Run with `npm run simulate`.
import { CARDS } from '../src/data/cards';
import { chooseAction, type Difficulty } from '../src/engine/ai';
import { createBattle, resolveTurn } from '../src/engine/battle';
import { createFighter } from '../src/engine/fighter';
import { shuffle, mulberry32 } from '../src/util/rng';

const GAMES = 400;

function play(a: Difficulty, b: Difficulty, level: number, seed: number) {
  const rng = mulberry32(seed);
  const team = () => shuffle(CARDS, rng).slice(0, 3).map((c) => createFighter(c, level));
  let battle = createBattle(team(), team());
  while (!battle.winner) {
    battle = resolveTurn(battle, chooseAction(battle, 'player', a, rng), chooseAction(battle, 'enemy', b, rng)).battle;
    if (battle.turn > 300) throw new Error(`Battle did not finish (seed ${seed})`);
  }
  return { winner: battle.winner, turns: battle.turn };
}

const matchups: [Difficulty, Difficulty][] = [
  ['easy', 'easy'],
  ['normal', 'easy'],
  ['hard', 'easy'],
  ['hard', 'normal'],
  ['normal', 'normal'],
  ['hard', 'hard'],
];

console.log('player  vs enemy   | player win% | avg turns');
for (const [a, b] of matchups) {
  let wins = 0;
  let turns = 0;
  for (let seed = 1; seed <= GAMES; seed++) {
    const result = play(a, b, 3, seed);
    if (result.winner === 'player') wins++;
    turns += result.turns;
  }
  console.log(`${a.padEnd(7)} vs ${b.padEnd(7)} | ${((wins / GAMES) * 100).toFixed(0).padStart(10)}% | ${(turns / GAMES).toFixed(1)}`);
}

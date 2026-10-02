import { describe, expect, it } from 'vitest';
import { chooseAction, type Difficulty } from '../src/engine/ai';
import { createBattle, isLegal, resolveTurn } from '../src/engine/battle';
import { CARDS } from '../src/data/cards';
import { generateEnemyTeam } from '../src/game/pve';
import { mulberry32 } from '../src/util/rng';
import { fighter } from './helpers';

describe('AI', () => {
  it.each<Difficulty>(['easy', 'normal', 'hard'])('%s always picks a legal action until the battle ends', (difficulty) => {
    for (let seed = 1; seed <= 20; seed++) {
      const rng = mulberry32(seed);
      let battle = createBattle(generateEnemyTeam(CARDS, 'normal', rng), generateEnemyTeam(CARDS, 'normal', rng));
      let turns = 0;
      while (!battle.winner) {
        const player = chooseAction(battle, 'player', difficulty, rng);
        const enemy = chooseAction(battle, 'enemy', difficulty, rng);
        expect(isLegal(battle, 'player', player)).toBe(true);
        expect(isLegal(battle, 'enemy', enemy)).toBe(true);
        battle = resolveTurn(battle, player, enemy).battle;
        expect(++turns).toBeLessThan(200); // no endless stalemate
      }
    }
  });

  it('normal and hard take a lethal attack when available', () => {
    // Enemy is faster and can kill the 1-HP player with any attack.
    const battle = createBattle([fighter({ hp: 1 })], [fighter({ atk: 400, spd: 99 })]);
    for (const difficulty of ['normal', 'hard'] as const) {
      const action = chooseAction(battle, 'enemy', difficulty, () => 0.99); // no random noise
      const after = resolveTurn(battle, { type: 'skill', index: 0 }, action).battle;
      expect(after.winner, difficulty).toBe('enemy');
    }
  });
});

import type { Difficulty } from '../engine/ai';
import { createFighter } from '../engine/fighter';
import type { CardDef, Fighter } from '../engine/types';
import { shuffle, type Rng } from '../util/rng';
import type { Player } from './player';
import { TEAM_SIZE } from './team';

interface DifficultyConfig {
  level: number;
  winCoins: number;
  loseCoins: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyConfig> = {
  easy: { level: 1, winCoins: 20, loseCoins: 5 },
  normal: { level: 3, winCoins: 40, loseCoins: 10 },
  hard: { level: 5, winCoins: 80, loseCoins: 15 },
};

export function generateEnemyTeam(cards: readonly CardDef[], difficulty: Difficulty, rng: Rng): Fighter[] {
  const { level } = DIFFICULTY[difficulty];
  return shuffle(cards, rng)
    .slice(0, TEAM_SIZE)
    .map((def) => createFighter(def, level));
}

/** Records the result on the player and returns the coins awarded. */
export function applyBattleResult(player: Player, difficulty: Difficulty, won: boolean): number {
  const config = DIFFICULTY[difficulty];
  const coins = won ? config.winCoins : config.loseCoins;
  player.coins += coins;
  if (won) player.wins += 1;
  else player.losses += 1;
  return coins;
}

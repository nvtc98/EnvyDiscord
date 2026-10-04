import type { Difficulty } from '../engine/ai';
import type { Player } from './player';

const COINS: Record<Difficulty, { win: number; other: number }> = {
  easy: { win: 20, other: 5 },
  normal: { win: 40, other: 10 },
  hard: { win: 80, other: 15 },
};

export type Outcome = 'won' | 'lost' | 'draw';

/** Records the result on the player and returns the coins awarded. */
export function applyBattleResult(player: Player, difficulty: Difficulty, outcome: Outcome): number {
  const coins = outcome === 'won' ? COINS[difficulty].win : COINS[difficulty].other;
  player.coins += coins;
  if (outcome === 'won') player.wins += 1;
  if (outcome === 'lost') player.losses += 1;
  return coins;
}

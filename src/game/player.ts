import { MAX_LEVEL } from '../engine/fighter';
import type { CardDef } from '../engine/types';

export const DUPLICATE_COINS = 50;

export interface Player {
  id: string;
  coins: number;
  wins: number;
  losses: number;
  /** Last claimed /daily as YYYY-MM-DD in the configured timezone. */
  lastDaily: string | null;
  /** cardId -> level */
  cards: Record<string, number>;
  /** cardIds chosen with /team; empty means "auto-pick". */
  team: string[];
}

export function createPlayer(id: string): Player {
  return { id, coins: 0, wins: 0, losses: 0, lastDaily: null, cards: {}, team: [] };
}

export interface GrantResult {
  card: CardDef;
  kind: 'new' | 'levelup' | 'maxed';
  level: number;
  /** Coins converted from a duplicate of a max-level card. */
  coins: number;
}

export function grantCard(player: Player, card: CardDef): GrantResult {
  const current = player.cards[card.id];
  if (current === undefined) {
    player.cards[card.id] = 1;
    return { card, kind: 'new', level: 1, coins: 0 };
  }
  if (current >= MAX_LEVEL) {
    player.coins += DUPLICATE_COINS;
    return { card, kind: 'maxed', level: current, coins: DUPLICATE_COINS };
  }
  player.cards[card.id] = current + 1;
  return { card, kind: 'levelup', level: current + 1, coins: 0 };
}

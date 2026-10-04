import type { CardDef } from '../engine/types';

/** Highest frame tier. The tier only changes how a card's frame looks; it never changes a card's strength. */
export const MAX_TIER = 5;

export interface Player {
  id: string;
  coins: number;
  wins: number;
  losses: number;
  /** Last claimed /daily as YYYY-MM-DD in the configured timezone. */
  lastDaily: string | null;
  /** cardId -> frame tier (1 to MAX_TIER). */
  cards: Record<string, number>;
  /** cardIds chosen with /deck; empty or invalid means "build one automatically". */
  deck: string[];
}

export function createPlayer(id: string): Player {
  return { id, coins: 0, wins: 0, losses: 0, lastDaily: null, cards: {}, deck: [] };
}

export interface GrantResult {
  card: CardDef;
  kind: 'new' | 'tier-up';
  tier: number;
}

/** Gives a card: a new one starts at tier 1, one the player already owns goes up a tier. */
export function grantCard(player: Player, card: CardDef): GrantResult {
  const current = player.cards[card.id];
  if (current === undefined) {
    player.cards[card.id] = 1;
    return { card, kind: 'new', tier: 1 };
  }
  if (current >= MAX_TIER) throw new Error(`${card.id} is already at the maximum frame tier`);
  player.cards[card.id] = current + 1;
  return { card, kind: 'tier-up', tier: current + 1 };
}

/** Cards that can still be received: not owned yet, or owned below the maximum tier. */
export const receivable = (player: Player, cards: readonly CardDef[]): CardDef[] =>
  cards.filter((c) => (player.cards[c.id] ?? 0) < MAX_TIER);

import type { CardDef, Rarity } from '../engine/types';
import type { Player } from './player';

export const TEAM_SIZE = 3;

export interface TeamMember {
  def: CardDef;
  level: number;
}

const RARITY_RANK: Record<Rarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };

export function ownedCards(player: Player, index: ReadonlyMap<string, CardDef>): TeamMember[] {
  return Object.entries(player.cards)
    .flatMap(([id, level]) => {
      const def = index.get(id);
      return def ? [{ def, level }] : [];
    })
    .sort(
      (a, b) =>
        RARITY_RANK[b.def.rarity] - RARITY_RANK[a.def.rarity] ||
        b.level - a.level ||
        a.def.name.localeCompare(b.def.name, 'en'),
    );
}

/** The saved team if still valid, otherwise the strongest 3 owned cards. Null if fewer than 3 owned. */
export function resolveTeam(player: Player, index: ReadonlyMap<string, CardDef>): TeamMember[] | null {
  const saved = [...new Set(player.team)].filter((id) => player.cards[id] !== undefined && index.has(id));
  if (saved.length === TEAM_SIZE) {
    return saved.map((id) => ({ def: index.get(id)!, level: player.cards[id] }));
  }
  const owned = ownedCards(player, index);
  return owned.length >= TEAM_SIZE ? owned.slice(0, TEAM_SIZE) : null;
}

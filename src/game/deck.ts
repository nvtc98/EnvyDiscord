import { DECK_SIZE, type CardDef } from '../engine/types';
import { shuffle, type Rng } from '../util/rng';
import type { Player } from './player';

export interface OwnedCard {
  def: CardDef;
  tier: number;
}

/** The player's cards, cheapest first, then by name. */
export function ownedCards(player: Player, index: ReadonlyMap<string, CardDef>): OwnedCard[] {
  return Object.entries(player.cards)
    .flatMap(([id, tier]) => {
      const def = index.get(id);
      return def ? [{ def, tier }] : [];
    })
    .sort((a, b) => a.def.cost - b.def.cost || a.def.name.localeCompare(b.def.name, 'en'));
}

export interface ResolvedDeck {
  cards: CardDef[];
  /** Cards borrowed for this battle only because the player owns fewer than DECK_SIZE. */
  guests: CardDef[];
}

/**
 * The deck to battle with: the saved deck if it is complete and still owned; otherwise the saved cards that are
 * still valid, topped up with other owned cards (highest frame tier first), and finally with random guest cards
 * the player does not own. Guests are never added to the collection.
 */
export function resolveDeck(player: Player, all: readonly CardDef[], index: ReadonlyMap<string, CardDef>, rng: Rng): ResolvedDeck {
  const owned = ownedCards(player, index);
  const ownedIds = new Set(owned.map((o) => o.def.id));

  const chosen: CardDef[] = [];
  const taken = new Set<string>();
  const take = (def: CardDef) => {
    if (chosen.length < DECK_SIZE && !taken.has(def.id)) {
      chosen.push(def);
      taken.add(def.id);
    }
  };

  for (const id of player.deck) {
    const def = index.get(id);
    if (def && ownedIds.has(id)) take(def);
  }
  for (const o of [...owned].sort((a, b) => b.tier - a.tier || a.def.cost - b.def.cost)) take(o.def);

  const guests = shuffle(all.filter((c) => !ownedIds.has(c.id)), rng).slice(0, DECK_SIZE - chosen.length);
  return { cards: [...chosen, ...guests], guests };
}

/** A random deck for the AI opponent. */
export function opponentDeck(all: readonly CardDef[], rng: Rng): CardDef[] {
  return shuffle(all, rng).slice(0, DECK_SIZE);
}

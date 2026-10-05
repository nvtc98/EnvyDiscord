import type { CardDef } from "../engine/types";
import type { StoryState } from "../story/types";
import {
  DEFAULT_VARIANT,
  nextUnownedVariant,
  type VariantId,
} from "../data/variants";

/**
 * Coins refunded when a duplicate arrives but the player already owns every variant of that card. Placeholder
 * value, tuned later. Defined here (not in shop.ts) so player.ts can use it without a circular import; shop.ts
 * re-exports it next to its own price constants.
 */
export const DUPLICATE_REBATE = 25;

/** One owned card: the set of variants the player owns (always at least `metal`) and the one shown right now. */
export interface OwnedCard {
  /** Owned variant ids, kept in registry order; always contains `metal`. */
  variants: VariantId[];
  /** The variant currently displayed; always one of `variants`. */
  active: VariantId;
}

export interface Player {
  id: string;
  coins: number;
  wins: number;
  losses: number;
  /** Last claimed /daily as YYYY-MM-DD in the configured timezone. */
  lastDaily: string | null;
  /** cardId -> owned variants and the active one. */
  cards: Record<string, OwnedCard>;
  /** cardIds chosen with /deck; empty or invalid means "build one automatically". */
  deck: string[];
  /** Null until the player runs /story for the first time. */
  story: StoryState | null;
}

export function createPlayer(id: string): Player {
  return {
    id,
    coins: 0,
    wins: 0,
    losses: 0,
    lastDaily: null,
    cards: {},
    deck: [],
    story: null,
  };
}

/** True once a player has done anything: started the story, owns cards, battled, or earned coins. */
export function hasPlayed(player: Player): boolean {
  return (
    player.story !== null ||
    Object.keys(player.cards).length > 0 ||
    player.wins > 0 ||
    player.losses > 0 ||
    player.coins > 0
  );
}

/** The variants a player owns for a card, in registry order (empty when the card is unowned). */
export function cardVariants(player: Player, cardId: string): VariantId[] {
  return player.cards[cardId]?.variants ?? [];
}

/** The active variant of an owned card, or undefined when the card is unowned. */
export function activeVariant(
  player: Player,
  cardId: string,
): VariantId | undefined {
  return player.cards[cardId]?.active;
}

/**
 * Switches which owned variant of a card is displayed. Returns true when it changed; false when the card is
 * unowned or the player does not own that variant (the active variant is left untouched).
 */
export function switchVariant(
  player: Player,
  cardId: string,
  variantId: VariantId,
): boolean {
  const owned = player.cards[cardId];
  if (!owned || !owned.variants.includes(variantId)) return false;
  owned.active = variantId;
  return true;
}

export interface GrantResult {
  card: CardDef;
  kind: "new" | "variant-unlocked" | "duplicate-refunded";
  /** The variant granted ('new' and 'variant-unlocked'); absent when the grant was refunded. */
  variant?: VariantId;
  /** Coins refunded ('duplicate-refunded' only). */
  refund?: number;
}

/**
 * Gives a card:
 * - a brand new card starts at `metal`;
 * - a duplicate unlocks the next not-yet-owned variant in registry order;
 * - a duplicate of a card whose variants are all owned refunds a small amount of coins.
 */
export function grantCard(player: Player, card: CardDef): GrantResult {
  const owned = player.cards[card.id];
  if (owned === undefined) {
    player.cards[card.id] = {
      variants: [DEFAULT_VARIANT],
      active: DEFAULT_VARIANT,
    };
    return { card, kind: "new", variant: DEFAULT_VARIANT };
  }
  const next = nextUnownedVariant(owned.variants);
  if (next !== null) {
    owned.variants.push(next);
    return { card, kind: "variant-unlocked", variant: next };
  }
  player.coins += DUPLICATE_REBATE;
  return { card, kind: "duplicate-refunded", refund: DUPLICATE_REBATE };
}

/** Cards that can still be received: unowned, or owned but still missing at least one variant. */
export const receivable = (
  player: Player,
  cards: readonly CardDef[],
): CardDef[] =>
  cards.filter((c) => nextUnownedVariant(cardVariants(player, c.id)) !== null);

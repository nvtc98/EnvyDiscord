import type { CardDef } from "../engine/types";
import { getVariant, type VariantId } from "../data/variants";
import { drawPack } from "./gacha";
import {
  grantCard,
  receivable,
  DUPLICATE_REBATE,
  type GrantResult,
  type Player,
} from "./player";
import type { Rng } from "../util/rng";

export const SHOP_CARD_PRICE = 100;
/** Flat price of any purchasable variant. */
export const SHOP_VARIANT_PRICE = 40;
/** Re-exported so the shop's price constants live together; the value is defined in player.ts (no circular import). */
export { DUPLICATE_REBATE };

export type ShopResult =
  | {
      ok: false;
      reason:
        | "insufficient-coins"
        | "pool-empty"
        | "not-owned"
        | "already-owned"
        | "not-purchasable";
    }
  | { ok: true; grant: GrantResult; coinsSpent: number };

export type VariantResult =
  | {
      ok: false;
      reason:
        | "insufficient-coins"
        | "not-owned"
        | "already-owned"
        | "not-purchasable";
    }
  | { ok: true; variant: VariantId; coinsSpent: number };

/** Buy one random card from the receivable pool. */
export function buyCard(
  player: Player,
  cards: readonly CardDef[],
  rng: Rng,
): ShopResult {
  if (player.coins < SHOP_CARD_PRICE)
    return { ok: false, reason: "insufficient-coins" };
  const pool = receivable(player, cards);
  if (pool.length === 0) return { ok: false, reason: "pool-empty" };
  const pick = drawPack(pool, rng, 1)[0];
  player.coins -= SHOP_CARD_PRICE;
  return {
    ok: true,
    grant: grantCard(player, pick),
    coinsSpent: SHOP_CARD_PRICE,
  };
}

/**
 * Buy a specific purchasable variant for a card the player already owns. The variant is added permanently to the
 * card's owned set (kept registry order); the active variant is left as-is. Fails cleanly when the card is not
 * owned, the variant is unknown/not purchasable, the player already owns it, or gold is short.
 */
export function buyVariant(
  player: Player,
  card: CardDef,
  variantId: VariantId,
): VariantResult {
  const owned = player.cards[card.id];
  if (owned === undefined) return { ok: false, reason: "not-owned" };
  const variant = getVariant(variantId);
  if (!variant || !variant.purchasable)
    return { ok: false, reason: "not-purchasable" };
  if (owned.variants.includes(variantId))
    return { ok: false, reason: "already-owned" };
  if (player.coins < SHOP_VARIANT_PRICE)
    return { ok: false, reason: "insufficient-coins" };
  player.coins -= SHOP_VARIANT_PRICE;
  // Keep registry order so "next unowned variant" logic and display stay stable.
  owned.variants.push(variantId);
  return { ok: true, variant: variantId, coinsSpent: SHOP_VARIANT_PRICE };
}

import { describe, expect, it } from 'vitest';
import { CARDS } from '../src/data/cards';
import { variantOrder } from '../src/data/variants';
import { createPlayer, grantCard, switchVariant } from '../src/game/player';
import { buyCard, buyVariant, SHOP_CARD_PRICE, SHOP_VARIANT_PRICE } from '../src/game/shop';
import { mulberry32 } from '../src/util/rng';

const ALL_VARIANTS = variantOrder();
const card = CARDS[0];

/** A player who owns `card` as metal with plenty of coins. */
function ownerOf(coins = 1000) {
  const player = createPlayer('u');
  player.coins = coins;
  grantCard(player, card); // new -> metal
  return player;
}

describe('buyVariant', () => {
  it('buys a purchasable, not-yet-owned variant: deducts the flat price and adds it in registry order', () => {
    const player = ownerOf();
    const before = player.coins;
    const result = buyVariant(player, card, 'purple');
    expect(result).toMatchObject({ ok: true, variant: 'purple', coinsSpent: SHOP_VARIANT_PRICE });
    expect(player.coins).toBe(before - SHOP_VARIANT_PRICE);
    expect(player.cards[card.id].variants).toContain('purple');
    // The active variant is not changed by a purchase.
    expect(player.cards[card.id].active).toBe('metal');
  });

  it('rejects a card the player does not own', () => {
    const player = createPlayer('u');
    player.coins = 1000;
    expect(buyVariant(player, card, 'blue')).toEqual({ ok: false, reason: 'not-owned' });
  });

  it('rejects a variant the player already owns', () => {
    const player = ownerOf();
    expect(buyVariant(player, card, 'metal')).toEqual({ ok: false, reason: 'already-owned' });
  });

  it('rejects an unknown or non-purchasable variant', () => {
    const player = ownerOf();
    expect(buyVariant(player, card, 'does-not-exist')).toEqual({ ok: false, reason: 'not-purchasable' });
  });

  it('rejects when the player cannot afford the price, leaving coins untouched', () => {
    const player = ownerOf(SHOP_VARIANT_PRICE - 1);
    expect(buyVariant(player, card, 'blue')).toEqual({ ok: false, reason: 'insufficient-coins' });
    expect(player.coins).toBe(SHOP_VARIANT_PRICE - 1);
    expect(player.cards[card.id].variants).toEqual(['metal']);
  });
});

describe('switchVariant', () => {
  it('switches the active variant among owned variants', () => {
    const player = ownerOf();
    buyVariant(player, card, 'red');
    expect(switchVariant(player, card.id, 'red')).toBe(true);
    expect(player.cards[card.id].active).toBe('red');
    expect(switchVariant(player, card.id, 'metal')).toBe(true);
    expect(player.cards[card.id].active).toBe('metal');
  });

  it('refuses to switch to a variant the player does not own, or an unowned card', () => {
    const player = ownerOf();
    expect(switchVariant(player, card.id, 'blue')).toBe(false); // not owned yet
    expect(player.cards[card.id].active).toBe('metal');
    expect(switchVariant(player, CARDS[1].id, 'metal')).toBe(false); // card not owned
  });
});

describe('buyCard', () => {
  it('spends coins and grants a card (first copy is metal)', () => {
    const player = createPlayer('u');
    player.coins = SHOP_CARD_PRICE;
    const result = buyCard(player, CARDS, mulberry32(1));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.coinsSpent).toBe(SHOP_CARD_PRICE);
      expect(result.grant.kind).toBe('new');
      expect(result.grant.variant).toBe('metal');
    }
    expect(player.coins).toBe(0);
  });

  it('rejects when the player cannot afford a card', () => {
    const player = createPlayer('u');
    player.coins = SHOP_CARD_PRICE - 1;
    expect(buyCard(player, CARDS, mulberry32(1))).toEqual({ ok: false, reason: 'insufficient-coins' });
  });

  it('reports an empty pool once every card owns every variant', () => {
    const player = createPlayer('u');
    player.coins = SHOP_CARD_PRICE;
    for (const c of CARDS) player.cards[c.id] = { variants: [...ALL_VARIANTS], active: 'metal' };
    expect(buyCard(player, CARDS, mulberry32(1))).toEqual({ ok: false, reason: 'pool-empty' });
  });
});

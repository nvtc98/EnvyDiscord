# Variant system design (2026-10-05)

This replaces the old per-card **frame tier** (1–5, duplicate → tier up, `TIER_BORDER`, `tier-<n>.png`) with a
data-driven **variant** system. A variant is a cosmetic colour version of a card. All variants are equal rank —
a variant changes only how a card looks, never its strength. Battle rules are unchanged.

## Registry (single source of truth)

Variants live in `src/data/variants.ts` as an ordered registry. Each entry is:

```ts
{ id: 'metal', name: 'Metal', purchasable: true,
  colors: { titleLight, titleDark, descFill } }
```

- The **order** of the registry is canonical and drives the duplicate-grant logic.
- `DEFAULT_VARIANT = 'metal'` is granted on first receipt and by the story starter.
- Adding a future variant is a single new registry entry — no code branches on specific variant ids.

Current variants, in order: **metal → blue → purple → red**, all `purchasable: true`. Future event-only variants
will set `purchasable: false`; the shop already respects the flag, so they are obtainable only via duplicates or
events, never bought.

## Ownership model

`Player.cards` is `Record<string, OwnedCard>` where `OwnedCard = { variants: VariantId[]; active: VariantId }`:

- `variants` is the set the player owns, kept in registry order; it always contains `metal`.
- `active` is the variant currently displayed; always one of `variants`.
- The player can freely switch `active` among owned variants (`switchVariant`).

Save files from the old tier model (`cards: Record<string, number>`) migrate on load in `src/db/json-repo.ts`:
each numeric entry becomes `{ variants: ['metal'], active: 'metal' }` (the old tier is discarded).

## Getting variants — the two paths

1. **Duplicates.** `grantCard` grants `metal` on first receipt (`kind: 'new'`). A duplicate unlocks the next
   not-yet-owned variant in registry order (`kind: 'variant-unlocked'`); the active variant is unchanged. This
   path may grant non-purchasable (event-only) variants too. Once every variant is owned, a further duplicate
   refunds `DUPLICATE_REBATE` coins (`kind: 'duplicate-refunded'`). A card is "receivable" (for `/daily` and the
   shop's random card) while it is unowned or still missing at least one variant.
2. **Shop.** `/shop variant <card> <variant>` buys a specific purchasable variant for a card the player already
   owns, at a flat `SHOP_VARIANT_PRICE`. It fails cleanly for `not-owned`, `already-owned`, `not-purchasable`
   (unknown or event-only), or `insufficient-coins`. The variant is added permanently to the card's owned set.

`SHOP_VARIANT_PRICE = 100` and `DUPLICATE_REBATE = 25` are placeholder values (named constants in
`src/game/shop.ts` / `src/game/player.ts`) to be tuned later.

## Palette

Each variant colours three regions, matching the existing blue frame style. The title banner is a radial
gradient `radial-gradient(<titleLight> 11%, <titleDark> 100%)`; the description panel is a translucent fill.
Blue is the standard the others mirror (exported from Dextrous). Title text is white **without** a dark outline;
cost/power badges keep their black radial fill with white text (and their outline).

| Variant | Title light | Title dark | Description fill        |
| ------- | ----------- | ---------- | ----------------------- |
| metal   | `#AAAAAA`   | `#171717`  | `rgba(102,102,102,0.58)` |
| blue    | `#0B57A5`   | `#000F1E`  | `rgba(3,32,62,0.48)`     |
| purple  | `#896AAE`   | `#2D1D40`  | `rgba(107,69,156,0.3)`   |
| red     | `#EC020E`   | `#280002`  | `rgba(236,32,41,0.33)`   |

Shared across variants: card 240 × 336, 10 px corner, 5 px outer outline; built-in/compact border is black
(`DEFAULT_BORDER`, matching metal).

## Frame files

The variant frames are **generated**: `npm run frames:variants` (`scripts/make-variant-frames.ts`, `src/render/variant-frames.ts`, `src/render/recolor.ts`) takes the Blue frame in `assets/frames/source/` (the Dextrous export with its white background removed) and recolours the title banner and the description panel with each variant's registry colours. Every banner pixel's position on the Blue gradient line is mapped to the same position on the target gradient (shape, anti-aliasing and alpha are kept); the description pixels take `descFill`'s colour and have their alpha rescaled to its opacity. The outline and the cost/power badges are shared, so they are identical in every file. A test (`tests/recolor.test.ts`) fails when a shipped file no longer matches the registry or when its banner and panel colours differ from the registry's, so changing a colour or adding a variant means running the command and committing the files. A variant whose design differs from a recolour can be exported from Dextrous and saved over its file by hand, but the next run of the command will overwrite it.

Frames are `assets/frames/variant-<id>.png` (transparent PNG/WebP). `FrameLibrary.forVariant(id)` loads the
file for that variant; a missing file falls back to `variant-metal.png`, then to any other variant file in
registry order, then to the built-in drawn frame (`null`) — mirroring the old nearest-tier fallback.

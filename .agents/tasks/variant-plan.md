# Implementation Plan — Replace card "tier" with data-driven "variant" system

This replaces the per-card frame **tier** (1–5, duplicate → tier-up, `TIER_BORDER`, `tier-N.png`) with a
data-driven **variant** system: a cosmetic color variant of a card, all variants equal rank. Each owned card
stores the SET of variants it owns (always including `metal`) plus the ACTIVE variant. Variants come from a
registry; adding one later is a single registry entry, no code branching on ids.

## Context discovered during exploration (read before implementing)

- Build/verify commands (from `package.json` and `README.md`): `npm run typecheck` (`tsc --noEmit`),
  `npm test` (`vitest run`). Run the full suite — tests are fast. Optionally `npm run preview` after render
  changes to eyeball images (writes to `preview/`, not required for CI).
- The working tree already has in-progress changes toward this task: `src/game/shop.ts` and
  `src/discord/commands/shop.ts` were partly renamed (`buyVariant`, `SHOP_VARIANT_PRICE`) but still implement
  the OLD tier model (`buyVariant` just calls `grantCard`/`MAX_TIER`). `draw.ts` already has the title-outline
  removed (`drawLine(..., false)` for the name) — PRESERVE that; do not re-add the title outline. Frame
  placeholders `assets/frames/variant-{metal,blue,purple,red}.png` already exist. Build on top; do NOT revert.
- `tier-1.png` still exists and is referenced by `tests/cutout.test.ts` (the Blue cutout test) and
  `tests/renderer.test.ts` (`tempAssets(withFrame)` copies `tier-1.png`). Keep `tier-1.png` on disk; those
  cutout tests are about the frame-cutout pipeline, not the variant model. Only the renderer test's
  frame-loading assertions change (see step 9).
- Current card ownership model: `Player.cards` is `Record<string, number>` (cardId → tier). Many callers read
  it as a plain number. The JSON repo (`src/db/json-repo.ts`) shallow-merges saved players over
  `createPlayer(id)` and drops the legacy `team` field; it does NOT deep-migrate `cards`. A save-file shape
  change for `cards` therefore needs an explicit migration there (step 3).
- Exact migration sites (grep of `tier|grantCard|MAX_TIER|forTier|TIER_BORDER|tiers|variant`): `src/game/player.ts`,
  `src/game/shop.ts`, `src/game/gacha.ts`, `src/game/deck.ts`, `src/db/json-repo.ts`, `src/story/prologue.ts`,
  `src/render/{renderer,draw,frames,theme,layout}.ts`, `src/discord/render.ts`,
  `src/discord/commands/{shop,daily,collection,card,battle}.ts`, `scripts/preview.ts`,
  `tests/{game,commands-flow,renderer,story,discord-helpers}.ts`. `profile.ts`, `admin.ts`, `deck.ts` (command),
  `cutout.test.ts` only use `cards`/counts and do NOT need variant logic, but `deck.ts` (game) sorts by `tier`
  and `discord-helpers.ts` seeds `player.cards[id] = tier` — both must be updated to the new shape.
- Decision: the variant registry lives at `src/data/variants.ts` (alongside `src/data/cards.ts`). Rationale:
  `src/data/` already holds the canonical card data; variants are the same kind of static game data.
- Decision: the new owned-card shape is `{ variants: VariantId[]; active: VariantId }` stored in
  `Player.cards: Record<string, OwnedCard>`. `variants` is kept in registry order; `active` is one of them.
  Rationale: an ordered array makes "next not-yet-owned variant in registry order" and "the set they own"
  both trivial, and serializes cleanly to JSON. (A set/object was considered but arrays preserve the canonical
  order the duplicate logic needs without a separate lookup.)
- Decision: new coins constants live in `src/game/shop.ts` next to the existing price constants
  (`SHOP_CARD_PRICE`): `SHOP_VARIANT_PRICE = 100` (flat variant price, replacing the old `30`) and
  `DUPLICATE_REBATE = 25` (refund when all variants are owned). Named constants, placeholder values the user
  will tune later.

---

- [ ] 1. Create the variant registry in `src/data/variants.ts`.
     Export `type VariantId = string`; an interface `Variant { id: VariantId; name: string; purchasable: boolean;
colors: { titleLight: string; titleDark: string; descFill: string } }`; a `VARIANTS: readonly Variant[]`
     array in canonical order `metal → blue → purple → red` with the EXACT palette below; `DEFAULT_VARIANT = 'metal'`;
     and helpers `getVariant(id): Variant | undefined`, `variantOrder(): VariantId[]`,
     `nextUnownedVariant(owned: VariantId[]): VariantId | null` (first registry id not in `owned`, else null),
     `purchasableVariants(): Variant[]`. Palette (title = radial gradient light→dark, desc = translucent fill):
     metal `titleLight #AAAAAA`, `titleDark #171717`, `descFill rgba(102,102,102,0.58)`;
     blue `#0B57A5`, `#000F1E`, `rgba(3,32,62,0.48)`;
     purple `#896AAE`, `#2D1D40`, `rgba(107,69,156,0.3)`;
     red `#EC020E`, `#280002`, `rgba(236,32,41,0.33)`. All four `purchasable: true`.
     Files: src/data/variants.ts
     Verify: `npm run typecheck` passes (file compiles; no consumers yet).

- [ ] 2. Rewrite the player data model and `grantCard` in `src/game/player.ts`.
     Remove `MAX_TIER`. Define `interface OwnedCard { variants: VariantId[]; active: VariantId }` and change
     `Player.cards` to `Record<string, OwnedCard>`. Add helper `cardVariants(player, cardId): VariantId[]` and
     `activeVariant(player, cardId): VariantId | undefined`. Rewrite `GrantResult` to
     `{ card: CardDef; kind: 'new' | 'variant-unlocked' | 'duplicate-refunded'; variant?: VariantId; refund?: number }`.
     Rewrite `grantCard(player, card)`: if unowned → create `{ variants: ['metal'], active: 'metal' }`, return
     `kind:'new', variant:'metal'`; if owned and `nextUnownedVariant` exists → append it, keep `active` as-is,
     return `kind:'variant-unlocked', variant:<new>`; if owned and all variants owned → add `DUPLICATE_REBATE`
     coins (import from shop or define the constant in player.ts and re-export; put it in `shop.ts` per the
     context decision and import it here), return `kind:'duplicate-refunded', refund:DUPLICATE_REBATE`.
     Replace `receivable`: a card is still receivable while it has at least one not-yet-owned variant OR is
     unowned (i.e. `nextUnownedVariant(cardVariants(player, id))` is non-null, treating unowned as `[]`). Keep
     `createPlayer`, `hasPlayed` (card count check works unchanged against the new map).
     Files: src/game/player.ts
     Verify: `npm run typecheck` (will surface every downstream caller — expected; later steps fix them). This
     step is complete when player.ts itself has no type errors internal to the file.

- [ ] 3. Add a save-file migration in `src/db/json-repo.ts` so old `cards: Record<string, number>` loads as the
     new shape. In `get()`, after merging, map any `cards` entry whose value is a `number` (legacy tier) to
     `{ variants: ['metal'], active: 'metal' }` (tier is discarded — variants are cosmetic and start at metal).
     Leave already-migrated object entries untouched. Keep the existing `team` drop.
     Files: src/db/json-repo.ts
     Verify: `npm test -- tests/game.test.ts` — the `JsonPlayerRepo` "upgrades a save file" test (and a new/
     updated assertion) confirms `{ 'tho-lua': 3 }` becomes `{ 'tho-lua': { variants:['metal'], active:'metal' } }`.
     (That test is updated in step 11; run it after this + step 11.)

- [ ] 4. Update `src/game/shop.ts`: constants, `buyVariant`, and `buyCard` return shape.
     Set `SHOP_CARD_PRICE` (keep 50), `SHOP_VARIANT_PRICE = 100`, add `DUPLICATE_REBATE = 25`. Rewrite
     `ShopResult` reasons to `'insufficient-coins' | 'pool-empty' | 'not-owned' | 'already-owned' | 'not-purchasable'`.
     Rewrite `buyVariant(player, card, variantId)`: fail `not-owned` if the player doesn't own the card; look up
     the variant in the registry, fail `not-purchasable` if missing or `purchasable:false`; fail `already-owned`
     if the player already owns that variant for the card; fail `insufficient-coins` if `coins < SHOP_VARIANT_PRICE`;
     otherwise deduct, push the variant into the card's `variants` (keep registry order), and return
     `{ ok:true, variant, coinsSpent }`. `buyCard` keeps using `grantCard`; its `ShopResult` now carries the
     new `GrantResult`.
     Files: src/game/shop.ts
     Verify: `npm run typecheck` (shop.ts compiles against new player.ts); covered by tests in step 11.

- [ ] 5. Update `src/game/gacha.ts` (`claimDaily`) and `src/game/deck.ts` (`ownedCards`/`resolveDeck`) for the
     new shape. gacha: `claimDaily` still maps `drawPack(...).map(card => grantCard(player, card))`; the
     `GrantResult` type now differs but the call site is unchanged — just confirm the `collection-complete`
     path still keys off `receivable`. deck: `OwnedCard` in deck.ts currently has `tier: number`; replace with
     `active`/`variants` or drop the tier field entirely and sort only by `cost` then `name` (the old secondary
     sort by `b.tier - a.tier` in `resolveDeck`'s top-up is cosmetic — replace with cost-only ordering since
     variants are equal rank). Update the JSDoc that says "highest frame tier first".
     Files: src/game/gacha.ts, src/game/deck.ts
     Verify: `npm run typecheck`; `npm test -- tests/game.test.ts` after step 11 updates the deck tests.

- [ ] 6. Repurpose `src/render/theme.ts`: remove `TIER_BORDER`. Add a neutral default border constant used by
     the built-in/compact frames, e.g. `export const DEFAULT_BORDER = '#000000'` (black, matching old tier-1/
     metal). Update the stale JSDoc. Do not touch `PALETTE`, `RARITY_COLOR`, `EMBED_COLOR`.
     Files: src/render/theme.ts
     Verify: `npm run typecheck` (draw.ts will error until step 7 — expected).

- [ ] 7. Rewrite frame loading in `src/render/frames.ts` from `forTier(tier)` to `forVariant(id)`.
     `forVariant(id)` loads `variant-<id>.png`; if missing, fall back to `variant-<DEFAULT_VARIANT>.png`
     (metal), then to any other variant file in registry order, then return `null` (caller draws the built-in
     frame) — mirroring the old nearest-tier fallback. Update the class JSDoc to describe `variant-<id>.png`.
     Files: src/render/frames.ts
     Verify: `npm run typecheck`; frame-loading behaviour checked by the renderer test in step 9.

- [ ] 8. Update the renderer draw code in `src/render/draw.ts` to color title + description from a variant palette.
     Change `bannerFill` to take the title gradient colors (light, dark) from the variant and build the radial
     gradient from them instead of the hard-coded blue. Change `drawBuiltInFrame` to take a variant (not a tier):
     use `DEFAULT_BORDER` for the outline, call `bannerFill` with the variant's title colors, and fill the
     description panel with the variant's `descFill`. In `drawFullCard`/`FullFace`, replace `tier: number` with
     `variant: VariantId` (default `metal` when absent) and thread it to the frame/banner/desc; look up the
     palette via `getVariant`. In `CompactFace`, replace `tier` with `variant`; `drawCompactCard` uses the
     variant's title colors for its banner fill and `DEFAULT_BORDER` for the border (keep the owner/rarity inner
     line logic). KEEP the title drawn WITHOUT outline (`drawLine(ctx, f.name, ..., false)`) and cost/power WITH
     outline — do not change that.
     Files: src/render/draw.ts
     Verify: `npm run typecheck`; renderer behaviour checked in step 9.

- [ ] 9. Update `src/render/renderer.ts`: `CardView.tier` → `CardView.variant: VariantId`; `BattleView.tiers` →
     `BattleView.variants?: Record<string, VariantId>` (card id → active variant; opponent and unspecified cards
     default to `metal`). In `compactFace`, replace the `tiers?.[id] ?? 1` logic with
     `card.owner === viewer ? (variants?.[id] ?? DEFAULT_VARIANT) : DEFAULT_VARIANT`. Replace
     `frames.forTier(view.tier)` with `frames.forVariant(view.variant)` in `cards()`. Update `pack()`'s inline
     compact face to pass `variant: DEFAULT_VARIANT` instead of `tier: 1`. Update the two interface doc comments.
     Files: src/render/renderer.ts
     Verify: `npm test -- tests/renderer.test.ts` after that test is updated in step 11. The renderer test's
     frame-fallback case changes from "nearest lower tier" to "falls back to metal / built-in frame"; the
     description-box color assertion stays blue only when rendering the `blue` variant, so update those calls to
     request `variant: 'blue'` (keeps the 48% navy assertion valid). Expected outcome: renderer tests pass.

- [ ] 10. Update every Discord command + text helper to use variant instead of tier.
      - `src/discord/render.ts`: remove `MAX_TIER` import and `tierLabel`; replace with a `variantLabel(id)` using
        the registry display name (e.g. `Variant: Metal`), or inline the variant name. Update `cardEmbed` to take
        a `variant` id (default metal) and show the variant name in the "Frame" field.
      - `src/discord/commands/card.ts`: read `activeVariant(player, def.id)`; render with that variant (default
        metal if unowned); update the ownership note and the `cardEmbed` fallback.
      - `src/discord/commands/collection.ts`: remove `MAX_TIER` usage; `ownedCards` no longer has `tier`. Render
        each card with its `active` variant; replace the "N at max tier" footer stat and the `TIER n` badge with
        a variant-count/variant-name (e.g. badge = variant display name; footer counts owned cards and total
        variants owned). Update the text-fallback `tierLabel` call to the new label.
      - `src/discord/commands/daily.ts`: rewrite `describeGrant` for the new `GrantResult` kinds
        (`new` / `variant-unlocked` / `duplicate-refunded`), render each granted card with its granted/active
        variant and a matching badge, and surface the refund coins in the footer when any grant refunded.
      - `src/discord/commands/shop.ts`: the `variant` subcommand must take BOTH a `card` (autocomplete over owned
        cards that still have a purchasable, not-yet-owned variant) AND a `variant` choice option (the purchasable
        variant ids from the registry). Call `buyVariant(player, card, variantId)`; map the new failure reasons
        (`not-owned`, `already-owned`, `not-purchasable`, `insufficient-coins`) to messages; on success render the
        card with the bought variant and report coins. Fix the `card` subcommand's `result.grant.tier`/`TIER`
        references to the new grant shape and variant badges. Fix the autocomplete predicate (currently
        `tier < 5`) to "owns the card and has at least one purchasable variant not yet owned".
      - `src/discord/commands/battle.ts`: `Session.tiers: Record<string, number>` → `variants: Record<string, VariantId>`;
        build it from each owned card's `active` variant (`Object.fromEntries(Object.entries(player.cards).map(([id, o]) => [id, o.active]))`)
        instead of `player.cards`; pass `variants` to `r.battle(...)`.
        Files: src/discord/render.ts, src/discord/commands/card.ts, src/discord/commands/collection.ts,
        src/discord/commands/daily.ts, src/discord/commands/shop.ts, src/discord/commands/battle.ts
        Verify: `npm run typecheck`; `npm test -- tests/commands-flow.test.ts` after step 11 updates those tests.

- [ ] 11. Update the story starter grant and ALL tests/helpers/scripts to the new shape.
      - `src/story/prologue.ts`: the `book` take-branch already calls `grantCard` per id — unchanged, but confirm
        it now grants metal (it does, via the new `grantCard` 'new' path). No tier assumptions elsewhere.
      - `scripts/preview.ts`: replace `tier:` with `variant:` on the `renderer.cards` calls (use `'metal'`,
        `'blue'`, `'purple'`, `'red'` across the daily sample to show all four), and replace the `tiers:` map on
        the battle call with a `variants:` map of variant ids.
      - `tests/discord-helpers.ts`: `MemoryRepo` is fine; update `ownEverything(ctx, userId, variant='metal')`
        to seed `player.cards[id] = { variants:[variant], active:variant }` (and callers that pass a tier number
        like `MAX_TIER`/`2` → pass a variant id or own-all-variants). Keep the helper's intent (give every card).
      - `tests/game.test.ts`: rewrite the `grantCard`/`receivable`/`claimDaily`/`decks` suites for variants:
        new → metal; duplicates unlock blue→purple→red in order; a further duplicate refunds `DUPLICATE_REBATE`
        coins and leaves variants full; `receivable` excludes a card whose variants are all owned; `claimDaily`
        "collection complete" now means every card owns every variant; the JsonPlayerRepo migration test asserts
        the number→`{variants:['metal'],active:'metal'}` upgrade; deck tests drop the tier-based ordering
        assertions (sort by cost only).
      - `tests/renderer.test.ts`: swap `tier:` → `variant:` on every `renderer.cards`/`pack` call; change the
        frame-fallback test to assert metal/built-in fallback (step 7/9 behaviour) and request `variant:'blue'`
        where the test checks the navy 48% description box.
      - `tests/commands-flow.test.ts`: update `/daily` "collection complete" setup (own every variant of every
        card, or use the updated `ownEverything`), `/collection` setup (`ownEverything(ctx,'u','metal')` etc.),
        the `MAX_TIER` import/usages, and `player.cards[id] = 1`/`4` seeds to the new object shape.
      - `tests/story.test.ts`: the "taking the cards grants exactly those twelve at tier 1" assertions
        (`Object.values(player.cards).every(t => t === 1)`) become "every owned card is `{variants:['metal'],
  active:'metal'}`". Other story assertions key off `Object.keys(player.cards)` and are unaffected.
        Files: src/story/prologue.ts (verify only), scripts/preview.ts, tests/discord-helpers.ts, tests/game.test.ts,
        tests/renderer.test.ts, tests/commands-flow.test.ts, tests/story.test.ts
        Verify: `npm test` — the full Vitest suite passes.

- [ ] 12. Full verification + cleanup.
      Run `npm run typecheck` and `npm test`; fix any remaining references (grep `tier|TIER_BORDER|forTier|MAX_TIER`
      across `src tests scripts` and confirm only intentional survivors remain — `tier-1.png` filename usages in
      `cutout.test.ts`/`renderer.test.ts` `tempAssets` are allowed and expected). Optionally run `npm run preview`
      to eyeball the four variants. Then DELETE the stray reference directory
      `New Folder With Items 3/` (plain filesystem delete; untracked, used only to extract the palette).
      Files: (no source changes expected beyond fixups)
      Verify: `npm run typecheck` and `npm test` both pass; `grep -rE "TIER_BORDER|forTier|MAX_TIER" src tests scripts`
      returns nothing; the `New Folder With Items 3/` directory no longer exists.

- [ ] 13. Update the design docs to make them the written source of the variant system.
      In `docs/superpowers/specs/`: add a short variant-system note (new file
      `2026-10-05-variant-system-design.md`) AND fix the tier/frame mentions in
      `2026-10-04-lane-battle-design.md` (the Duplicates/Rarity/Card-art table rows, the "Frame tier" data-model
      bullet §122–123, the `assets/frames/tier-<n>.png` frame-rendering §175, the board-card §184 "tier's border
      colour", the §228 "Maximum frame tier is 5"). The note must state: data-driven extensible registry
      (`src/data/variants.ts`), `metal` is the default granted on first receipt and by the story starter;
      duplicates grant the next variant in registry order (metal→blue→purple→red→future) and refund
      `DUPLICATE_REBATE` coins once all are owned; the shop sells only `purchasable:true` variants at a flat
      `SHOP_VARIANT_PRICE`; future event-only variants use `purchasable:false` (obtainable only via dupes/events);
      the per-variant palette table (title light/dark + desc fill, from the Dextrous exports, blue is the
      standard); frame files are `assets/frames/variant-<id>.png` with metal/built-in fallback; and that variants
      are purely cosmetic (no stat/power effect, battle rules unchanged). Also update the matching `/daily`,
      "Collection" and "Card rendering" lines in `README.md` that still say "frame tier".
      Files: docs/superpowers/specs/2026-10-05-variant-system-design.md,
      docs/superpowers/specs/2026-10-04-lane-battle-design.md, README.md
      Verify: `npm run typecheck` and `npm test` still pass (docs are prose; this confirms nothing else broke);
      manually confirm no "tier" wording remains in the touched doc sections except historical/changelog context.

## Notes & assumptions

- The shop `variant` subcommand gains a required `variant` choice option. If the user later wants the shop to
  auto-pick the next unowned variant instead of choosing, that is a small follow-up; the explicit choice is
  assumed here because the design says "buy a variant for a specific card" and lists which variants are owned.
- `DUPLICATE_REBATE = 25` and `SHOP_VARIANT_PRICE = 100` are placeholder values per the user's instruction; they
  are named constants in `src/game/shop.ts` so tuning is a one-line change.
- `tier-1.png` is intentionally retained: it is the Blue-frame cutout fixture for `cutout.test.ts` and the
  render test's `tempAssets`. The variant frames are the new `variant-*.png` placeholders already on disk.
- The loop stop contract is unchanged: the implement-and-review loop stops when
  `.agents/tasks/variant-review.json` has `verdict` == `APPROVED`.

## Implementation evidence (iteration 1 — 2026-10-05)

Implemented the full design: variant registry (`src/data/variants.ts`), `OwnedCard` model + `grantCard`
(`new`/`variant-unlocked`/`duplicate-refunded`) + `switchVariant` + `receivable` in `src/game/player.ts`,
save-file migration in `src/db/json-repo.ts` (legacy numeric tier → `{variants:['metal'],active:'metal'}`),
`buyVariant`/`buyCard` in `src/game/shop.ts` (`SHOP_VARIANT_PRICE=100`, `DUPLICATE_REBATE=25`),
`deck.ts`/`gacha.ts` migration, renderer stack (`frames.forVariant`, `draw.ts` variant palette for
title gradient + description fill, `theme.ts` `DEFAULT_BORDER`, `renderer.ts` `CardView.variant` /
`BattleView.variants`), all Discord commands (`render.ts` `variantLabel`, `card`/`collection`/`daily`/`shop`/
`battle`), `scripts/preview.ts`, and tests (migrated `game`/`renderer`/`commands-flow`/`story`/`story-flow`/
`admin`/`discord-helpers`; added `tests/shop.test.ts` for buyVariant + switchVariant + buyCard, and `/shop
variant` command-flow cases). Docs: new `2026-10-05-variant-system-design.md`, updated the lane-battle doc's
tier mentions and `README.md`. Deleted the stray `New Folder With Items 3/`.

Verification (run with the binaries directly, not `npm run`):

- `node ./node_modules/typescript/bin/tsc --noEmit` → clean (exit 0, no output).
- `node ./node_modules/vitest/vitest.mjs run` → **14 test files passed, 216 tests passed** (exit 0).
- `grep -rE "TIER_BORDER|forTier|MAX_TIER" src tests scripts` → no matches. No lingering `tier` references in
  `src` except the migration comment in `json-repo.ts`; `tier-1.png` on disk is retained as the cutout fixture.

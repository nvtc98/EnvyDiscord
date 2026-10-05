// Card variants: cosmetic colour versions of a card. All variants are equal rank — a variant only changes how a
// card looks, never its strength. This registry is the single source of truth and ordering: a player's first copy
// of a card is `metal`; each duplicate unlocks the next variant in registry order; the shop sells the variants
// flagged `purchasable`. Adding a future variant is a single entry here — no code branches on specific ids.

export type VariantId = string;

export interface VariantColors {
  /** Light stop of the title banner's radial gradient. */
  titleLight: string;
  /** Dark stop of the title banner's radial gradient. */
  titleDark: string;
  /** Translucent fill of the description panel. */
  descFill: string;
}

export interface Variant {
  id: VariantId;
  /** Display name shown to players, e.g. "Metal". */
  name: string;
  /** Whether the shop may sell this variant. Event-only variants set this false (obtainable via duplicates/events). */
  purchasable: boolean;
  colors: VariantColors;
}

/**
 * Canonical variant order. The order is used when granting duplicates (first not-yet-owned variant is granted).
 * The palette matches the Dextrous frame exports; `blue` is the existing standard the others mirror.
 */
export const VARIANTS: readonly Variant[] = [
  {
    id: 'metal',
    name: 'Metal',
    purchasable: true,
    colors: { titleLight: '#AAAAAA', titleDark: '#171717', descFill: 'rgba(102,102,102,0.58)' },
  },
  {
    id: 'blue',
    name: 'Blue',
    purchasable: true,
    colors: { titleLight: '#0B57A5', titleDark: '#000F1E', descFill: 'rgba(3,32,62,0.48)' },
  },
  {
    id: 'purple',
    name: 'Purple',
    purchasable: true,
    colors: { titleLight: '#896AAE', titleDark: '#2D1D40', descFill: 'rgba(107,69,156,0.3)' },
  },
  {
    id: 'red',
    name: 'Red',
    purchasable: true,
    colors: { titleLight: '#EC020E', titleDark: '#280002', descFill: 'rgba(236,32,41,0.33)' },
  },
] as const;

/** The variant every card starts at: granted on first receipt and by the story starter. */
export const DEFAULT_VARIANT: VariantId = 'metal';

const INDEX = new Map<VariantId, Variant>(VARIANTS.map((v) => [v.id, v]));

export function getVariant(id: VariantId): Variant | undefined {
  return INDEX.get(id);
}

/** The variant ids in canonical order. */
export function variantOrder(): VariantId[] {
  return VARIANTS.map((v) => v.id);
}

/** The first registry variant the player does not yet own for a card, or null when they own all of them. */
export function nextUnownedVariant(owned: readonly VariantId[]): VariantId | null {
  const have = new Set(owned);
  for (const v of VARIANTS) if (!have.has(v.id)) return v.id;
  return null;
}

/** Variants the shop is allowed to sell. */
export function purchasableVariants(): Variant[] {
  return VARIANTS.filter((v) => v.purchasable);
}

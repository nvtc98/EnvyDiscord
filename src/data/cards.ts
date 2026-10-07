import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CardDef, Faction, Rarity } from "../engine/types";
import { cardFaction } from "../engine/abilities";
import { parseAbility } from "./ability-parse";

// cards.json is the single source of truth for every card: name, rarity, cost, power,
// and an optional ability shorthand (parsed by ability-parse.ts). The designer edits that
// file directly. A card's id is derived from its name via slugify, so renaming a card changes
// its id. The `note` field in cards.json is designer documentation and is dropped on load.

interface Entry {
  name: string;
  rarity?: Rarity;
  cost: number;
  power: number;
  /** Ability shorthand, e.g. "rebirth 4". Parsed into CardDef.ability. */
  ability?: string;
  /** Rules text shown on the card. Overrides the ability-derived text. */
  text?: string;
  /** Which deck/visual family the card belongs to. Defaults to "the-eyes" on load. */
  faction?: Faction;
  /** Balance-meter coefficient carrier for cards whose ability slot is otherwise used (§6). */
  coefficient?: number;
  /** Designer-only Vietnamese note. Dropped on load; never reaches CardDef. */
  note?: string;
}

const FACTIONS = new Set<Faction>(["the-eyes", "botuoi"]);

export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const entries = JSON.parse(
  readFileSync(fileURLToPath(new URL("./cards.json", import.meta.url)), "utf8"),
) as Entry[];

const seen = new Set<string>();
export const CARDS: CardDef[] = entries.map(
  ({ name, rarity, cost, power, ability, text, faction, coefficient }) => {
    const id = slugify(name);
    if (seen.has(id))
      throw new Error(
        `cards.json: "${name}" produces a duplicate card id "${id}"`,
      );
    seen.add(id);
    if (faction !== undefined && !FACTIONS.has(faction))
      throw new Error(
        `cards.json: card "${name}" has unknown faction "${faction}"`,
      );
    const card: CardDef = {
      id,
      name,
      rarity,
      cost,
      power,
      faction: faction ?? "the-eyes",
    };
    if (ability !== undefined) card.ability = parseAbility(ability, name);
    if (text !== undefined) card.text = text;
    if (coefficient !== undefined) card.coefficient = coefficient;
    return card;
  },
);

export const CARD_INDEX: Map<string, CardDef> = new Map(
  CARDS.map((c) => [c.id, c]),
);

// Players may only ever collect, be shown, buy, or receive The Eyes cards. Opponent-faction cards
// (botuoi, and any future non-the-eyes faction) stay in CARDS/CARD_INDEX so the engine can resolve
// them for opponent decks, but they must NEVER leak into a player-collectible flow. Every player-facing
// source (gacha/daily/shop pool, story starter pack + name match, deck guest top-up, collection totals)
// draws from COLLECTIBLE_CARDS instead of CARDS. The-eyes is hard-set as the sole collectible faction.
export const COLLECTIBLE_CARDS: CardDef[] = CARDS.filter(
  (c) => cardFaction(c) === "the-eyes",
);

export const COLLECTIBLE_CARD_INDEX: Map<string, CardDef> = new Map(
  COLLECTIBLE_CARDS.map((c) => [c.id, c]),
);

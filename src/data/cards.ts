import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CardDef, Rarity } from "../engine/types";
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
  /** Designer-only Vietnamese note. Dropped on load; never reaches CardDef. */
  note?: string;
}

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
  ({ name, rarity, cost, power, ability }) => {
    const id = slugify(name);
    if (seen.has(id))
      throw new Error(
        `cards.json: "${name}" produces a duplicate card id "${id}"`,
      );
    seen.add(id);
    const card: CardDef = { id, name, rarity, cost, power };
    if (ability !== undefined) card.ability = parseAbility(ability, name);
    return card;
  },
);

export const CARD_INDEX: Map<string, CardDef> = new Map(
  CARDS.map((c) => [c.id, c]),
);

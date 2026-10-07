import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DECK_SIZE, type CardDef } from "../engine/types";
import { CARD_INDEX } from "./cards";

// npcs.json is the single source of truth for every scripted opponent: display name, fixed deck,
// portrait key, and (optionally) the cards guaranteed into its opening hand and whether it takes the
// first turn. The designer edits that file directly. It is validated on load (throw loudly), mirroring
// cards.ts, so a malformed NPC is a startup/data error rather than a silent degrade.

export interface NPCDef {
  /** Stable id, slug form, e.g. "bo-spd". Unique across NPCS. */
  id: string;
  /** Display name shown as the opponent HUD name, e.g. "Bò SPD". */
  name: string;
  /** Exactly DECK_SIZE (12) card ids. DUPLICATES ALLOWED. Every id must resolve in CARD_INDEX. */
  deck: string[];
  /** Portrait asset key under assets/portraits/, e.g. "boss-spd-battle". */
  portrait: string;
  /**
   * OPTIONAL. Card ids guaranteed to be in this NPC's opening hand. Each MUST appear in `deck`.
   * The count-vs-hand-size check is enforced at battle construction (seedGuaranteedOpening), because
   * the hand size depends on who moves first.
   */
  guaranteedOpening?: string[];
  /** OPTIONAL. true = this NPC takes the first turn; absent/false = the player goes first. */
  goesFirst?: boolean;
  // --- RESERVED for the later tutorial task; NOT read or implemented now. ---
  // dialogue?: ...;   // per-NPC battle barks / intro lines
  // difficulty?: Difficulty;  // per-NPC AI difficulty override
  // ai?: ...;         // scripted-AI script (e.g. "play card X on turn 1")
}

/** Validate a single NPC entry against the card index. Throws loudly on the first problem found. */
export function validateNpc(
  entry: NPCDef,
  index: ReadonlyMap<string, CardDef> = CARD_INDEX,
): void {
  if (typeof entry.id !== "string" || entry.id.length === 0)
    throw new Error("npcs.json: an NPC is missing a non-empty id");
  if (typeof entry.name !== "string" || entry.name.length === 0)
    throw new Error(`npcs.json: NPC "${entry.id}" is missing a non-empty name`);
  if (!Array.isArray(entry.deck) || entry.deck.length !== DECK_SIZE)
    throw new Error(
      `npcs.json: NPC "${entry.id}" deck has ${Array.isArray(entry.deck) ? entry.deck.length : 0} cards, expected ${DECK_SIZE}`,
    );
  for (const cardId of entry.deck)
    if (!index.has(cardId))
      throw new Error(
        `npcs.json: NPC "${entry.id}" deck has unknown card id "${cardId}"`,
      );
  if (typeof entry.portrait !== "string" || entry.portrait.length === 0)
    throw new Error(
      `npcs.json: NPC "${entry.id}" is missing a non-empty portrait`,
    );
  if (entry.guaranteedOpening !== undefined) {
    if (!Array.isArray(entry.guaranteedOpening))
      throw new Error(
        `npcs.json: NPC "${entry.id}" guaranteedOpening must be an array`,
      );
    for (const cardId of entry.guaranteedOpening)
      if (!entry.deck.includes(cardId))
        throw new Error(
          `npcs.json: NPC "${entry.id}" guaranteedOpening card "${cardId}" is not in its deck`,
        );
  }
}

/** Validate a list of NPC entries (uniqueness across the list + each entry). Throws loudly. */
export function validateNpcs(
  list: NPCDef[],
  index: ReadonlyMap<string, CardDef> = CARD_INDEX,
): void {
  const seen = new Set<string>();
  for (const entry of list) {
    if (typeof entry.id === "string" && seen.has(entry.id))
      throw new Error(`npcs.json: duplicate NPC id "${entry.id}"`);
    validateNpc(entry, index);
    seen.add(entry.id);
  }
}

const entries = JSON.parse(
  readFileSync(fileURLToPath(new URL("./npcs.json", import.meta.url)), "utf8"),
) as NPCDef[];

validateNpcs(entries);

export const NPCS: NPCDef[] = entries;

export const NPC_INDEX: Map<string, NPCDef> = new Map(
  NPCS.map((n) => [n.id, n]),
);

/** Resolve an NPC's 12 card ids into CardDefs (duplicates become repeated def references). */
export function npcDeck(
  npc: NPCDef,
  index: ReadonlyMap<string, CardDef> = CARD_INDEX,
): CardDef[] {
  return npc.deck.map((id) => {
    const def = index.get(id);
    if (!def)
      throw new Error(
        `npcDeck: NPC "${npc.id}" references unknown card id "${id}"`,
      );
    return def;
  });
}

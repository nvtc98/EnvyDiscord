import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_VARIANT } from "../data/variants";
import { createPlayer, type OwnedCard, type Player } from "../game/player";
import type { PlayerRepo } from "./repository";

interface FileShape {
  players: Record<string, Player>;
}

/**
 * Upgrades `cards` from the old tier model to the variant model. A legacy entry is a number (the frame tier):
 * the tier is discarded — variants are cosmetic and start at `metal`. Already-migrated object entries pass
 * through unchanged.
 */
function migrateCards(
  cards: Record<string, unknown> | undefined,
): Record<string, OwnedCard> {
  const out: Record<string, OwnedCard> = {};
  for (const [id, value] of Object.entries(cards ?? {})) {
    if (typeof value === "number") {
      out[id] = { variants: [DEFAULT_VARIANT], active: DEFAULT_VARIANT };
    } else {
      out[id] = value as OwnedCard;
    }
  }
  return out;
}

export class JsonPlayerRepo implements PlayerRepo {
  private pending: Promise<void> = Promise.resolve();

  private constructor(
    private readonly path: string,
    private readonly data: FileShape,
  ) {}

  /** A corrupt file throws instead of starting empty, so a bad parse can never wipe saved progress. */
  static async open(path: string): Promise<JsonPlayerRepo> {
    await mkdir(dirname(path), { recursive: true });
    let data: FileShape = { players: {} };
    try {
      const parsed = JSON.parse(
        await readFile(path, "utf8"),
      ) as Partial<FileShape>;
      if (typeof parsed.players !== "object" || parsed.players === null) {
        throw new Error('missing "players" field');
      }
      data = { players: parsed.players };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(`Could not read ${path}: ${(error as Error).message}`);
      }
    }
    return new JsonPlayerRepo(path, data);
  }

  get(id: string): Player {
    const existing = this.data.players[id];
    if (!existing) return createPlayer(id);
    // Fill in fields that older save files do not have, and drop ones that no longer exist (`team`, from the 3v3 game).
    const { team: _legacyTeam, ...rest } = structuredClone(
      existing,
    ) as Player & { team?: unknown };
    const merged = { ...createPlayer(id), ...rest };
    merged.cards = migrateCards(merged.cards);
    return merged;
  }

  save(player: Player): Promise<void> {
    this.data.players[player.id] = structuredClone(player);
    const next = this.pending.then(() => this.write());
    this.pending = next.catch(() => undefined); // keep the chain alive after a failed write
    return next;
  }

  /** Reuses get() so admin views see the same normalized shape commands do. */
  all(): Player[] {
    return Object.keys(this.data.players).map((id) => this.get(id));
  }

  flush(): Promise<void> {
    return this.pending;
  }

  /** Write to a temp file then rename, so a crash mid-write cannot leave a half-written file. */
  private async write(): Promise<void> {
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(this.data, null, 2), "utf8");
    await rename(tmp, this.path);
  }
}

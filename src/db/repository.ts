import type { Player } from "../game/player";

/**
 * `get` is synchronous on purpose: a command can read, modify and call `save`
 * without an `await` in between, so two commands from one user can never
 * interleave a read-modify-write.
 */
export interface PlayerRepo {
  /** Returns a copy; changes only persist through `save`. Creates a fresh player if unknown. */
  get(id: string): Player;
  save(player: Player): Promise<void>;
  /** Every known player, as copies. Order is unspecified. For admin/inspection only. */
  all(): Player[];
  /** Resolves once all pending writes have reached disk. */
  flush(): Promise<void>;
}

/**
 * Per-interaction idempotency for the top-level dispatcher. Discord's gateway can deliver one
 * `InteractionCreate` more than once (on a resume/reconnect), and the recent benign-ack swallow means
 * a redelivered interaction no longer aborts at its second `update()` — so without this guard a single
 * user action could advance and re-send a story scene twice. `interaction.id` is stable across
 * redeliveries of the same interaction, so recording it lets the duplicate be dropped at the source.
 *
 * The record is bounded: the newest ids are kept in a FIFO set capped at {@link DEDUP_CAP} so a
 * long-running single process cannot grow it without limit. A reused id (older than the cap) would be
 * treated as new, but Snowflake ids are not reused within that window, so this is safe in practice.
 */
const DEDUP_CAP = 500;

const seen = new Set<string>();

/**
 * Records an interaction id and reports whether it was already seen. Returns `true` for a duplicate
 * (the caller should drop it) and `false` the first time an id is observed.
 */
export function seenInteraction(id: string): boolean {
  if (seen.has(id)) return true;
  seen.add(id);
  // Evict the oldest ids once over the cap (Set iterates in insertion order).
  if (seen.size > DEDUP_CAP) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
  return false;
}

/** Test seam: clear the dedup record so ids from one test do not leak into another. */
export function resetSeenInteractions(): void {
  seen.clear();
}

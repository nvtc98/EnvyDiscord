/** Work with the names of The Eyes: cleaning what a player types, finding it in the list, and suggesting the nearest. */

export const SUFFIX = "Eyes";
export const MAX_STEM = 30;

const stemOf = (name: string): string => name.replace(/\s+eyes$/i, "").trim();

/** Compares names ignoring case, accents, spaces, hyphens and apostrophes, so "X Ray" matches "X-Ray". */
const normalize = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/**
 * What the player typed, reduced to the part before "Eyes": only letters, digits, spaces, apostrophes, dots and
 * hyphens are kept, spaces collapsed, a typed
 * "Eyes" at the end dropped (the game adds it), and the length capped.
 */
export function cleanStem(input: string): string {
  const text = input
    .replace(/[^\p{L}\p{N}\s'’.-]/gu, "") // plain characters only: no markdown, mentions or links
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*\beyes$/i, "")
    .trim();
  return text.slice(0, MAX_STEM).trim();
}

/**
 * True when a cleaned stem normalizes to "stranger" (ignoring a trailing "Eyes" and all case/accents/spaces/
 * punctuation), so "stranger", "Stranger", "  stranger  " and "stranger eyes" all match. Used to hard-block the
 * reserved alias "Stranger Eyes" during name entry.
 */
export const isStrangerStem = (stem: string): boolean =>
  normalize(stemOf(stem)) === "stranger";

/**
 * Cleans a free-text DISPLAY name (an inviter's Discord display name) for safe insertion into story
 * text: it uses the same character filter as `cleanStem` (letters, digits, spaces, apostrophes, dots
 * and hyphens only — no markdown, mentions or links), collapses whitespace, trims and caps the length.
 * Unlike `cleanStem` it does NOT drop a trailing "Eyes" (this is a display name, not a name stem, so
 * "Ocean Eyes" must survive intact) and falls back to "someone" when nothing usable remains.
 */
export function sanitizeDisplay(input: string): string {
  const text = input
    .replace(/[^\p{L}\p{N}\s'’.-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .trim();
  return text || "someone";
}

/** "ocean" becomes "Ocean Eyes". Each word and each hyphenated part starts with a capital; "alterra's" keeps its lowercase s. */
export function displayName(stem: string): string {
  const titled = stem
    .toLowerCase()
    .replace(
      /(^|[\s-])(\p{L})/gu,
      (_, sep: string, ch: string) => sep + ch.toUpperCase(),
    );
  return `${titled} ${SUFFIX}`;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = temp;
    }
  }
  return row[b.length];
}

export type NameMatch =
  | { kind: "exact"; canonical: string }
  | { kind: "near"; suggestion: string }
  | { kind: "none" };

/**
 * Looks a name up in the list of The Eyes. An exact match (ignoring case, accents and punctuation) returns the
 * list's own spelling. Otherwise the closest name is suggested when it is close enough to be a plausible slip.
 */
export function matchName(stem: string, names: readonly string[]): NameMatch {
  const wanted = normalize(stem);
  if (!wanted) return { kind: "none" };

  let best: { name: string; d: number } | null = null;
  for (const name of names) {
    const candidate = normalize(stemOf(name));
    if (candidate === wanted) return { kind: "exact", canonical: name };
    const d = distance(wanted, candidate);
    if (!best || d < best.d || (d === best.d && name < best.name))
      best = { name, d };
  }
  if (!best) return { kind: "none" };

  const longest = Math.max(wanted.length, normalize(stemOf(best.name)).length);
  const allowed = longest <= 3 ? 1 : Math.max(2, Math.floor(longest * 0.34));
  return best.d <= allowed
    ? { kind: "near", suggestion: best.name }
    : { kind: "none" };
}

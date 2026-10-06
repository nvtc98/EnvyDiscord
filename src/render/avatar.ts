import { loadImage, type Canvas, type Image } from "@napi-rs/canvas";

/** The ONE canonical declaration — renderer.ts, draw.ts and battle-session.ts all import this. */
export type AvatarImage = Canvas | Image;

export type FetchAvatar = (url: string) => Promise<Buffer | null>;

const defaultFetchAvatar: FetchAvatar = async (url) => {
  try {
    const res = await fetch(url); // global fetch, Node >= 18
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null; // network / timeout -> null -> placeholder
  }
};

let fetchAvatarImpl = defaultFetchAvatar;

/** Test seam: replace the avatar fetch (e.g. a stub returning a fixture buffer or null). Call with no args to reset. */
export function setFetchAvatar(fn: FetchAvatar = defaultFetchAvatar): void {
  fetchAvatarImpl = fn;
}

/** Fetches a Discord avatar URL and decodes it to a drawable image, or null on any failure. */
export async function loadPlayerAvatar(
  url: string | null,
): Promise<AvatarImage | null> {
  if (!url) return null;
  const buf = await fetchAvatarImpl(url);
  if (!buf) return null;
  try {
    return await loadImage(buf);
  } catch {
    return null; // decode failure -> placeholder
  }
}

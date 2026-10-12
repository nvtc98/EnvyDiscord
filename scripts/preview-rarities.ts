// Renders one image per rarity, showing ONLY the cards that have real art in assets/cards/.
// Output goes to ./preview as rarity-<rarity>.png. Run: npm run preview:rarities
import { access, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CARDS } from "../src/data/cards";
import type { Rarity } from "../src/engine/types";
import { createImageRenderer } from "../src/render/renderer";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = `${root}preview/`;
const cardsDir = `${root}assets/cards/`;
await mkdir(outDir, { recursive: true });

const EXTENSIONS = ["png", "webp", "jpg", "jpeg"];
const hasArt = async (cardId: string): Promise<boolean> => {
  for (const ext of EXTENSIONS) {
    try {
      await access(`${cardsDir}${cardId}.${ext}`);
      return true;
    } catch {
      // try next extension
    }
  }
  return false;
};

const renderer = await createImageRenderer({ assetsDir: `${root}assets` });
const save = async (name: string, buffer: Buffer) => {
  await writeFile(`${outDir}${name}`, buffer);
  console.log(`${name}  ${(buffer.length / 1024).toFixed(0)} KB`);
};

const RARITIES: Rarity[] = ["common", "bargain", "eternal"];

for (const rarity of RARITIES) {
  const withArt = [];
  for (const card of CARDS) {
    if (card.rarity !== rarity) continue;
    if (await hasArt(card.id)) withArt.push(card);
  }
  if (withArt.length === 0) {
    console.log(`rarity-${rarity}: no cards with art, skipped`);
    continue;
  }
  const buffer = await renderer.cards(
    withArt.map((def) => ({ def, variant: "metal" })),
    { scale: 2 },
  );
  await save(`rarity-${rarity}.png`, buffer);
}

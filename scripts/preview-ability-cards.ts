import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CARDS } from "../src/data/cards";
import { createImageRenderer } from "../src/render/renderer";
const root = fileURLToPath(new URL("..", import.meta.url));
await mkdir(`${root}preview/`, { recursive: true });
const renderer = await createImageRenderer({ assetsDir: `${root}assets` });
const withAbility = CARDS.filter((c) => (c.faction ?? "the-eyes") === "the-eyes" && c.ability !== undefined);
for (const rarity of ["eternal", "bargain", "common"] as const) {
  const group = withAbility.filter((c) => c.rarity === rarity).sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
  if (!group.length) continue;
  const buf = await renderer.cards(group.map((def) => ({ def, variant: "metal" })), { scale: 2 });
  await writeFile(`${root}preview/ability-${rarity}.png`, buf);
  console.log(`ability-${rarity}.png  ${group.map((c) => c.name).join(", ")}`);
}

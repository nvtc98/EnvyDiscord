// Renders sample images to ./preview so you can check the look without Discord. Run: npm run preview
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CARDS } from "../src/data/cards";
import { playAiTurn } from "../src/engine/ai";
import { endTurn, legalPlays, newGame, playCard } from "../src/engine/rules";
import type { GameState } from "../src/engine/types";
import { drawStarterPack } from "../src/game/starter";
import { createImageRenderer } from "../src/render/renderer";
import { mulberry32 } from "../src/util/rng";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = `${root}preview/`;
await mkdir(outDir, { recursive: true });

const renderer = await createImageRenderer({ assetsDir: `${root}assets` });
const byRarity = (rarity: "common" | "bargain" | "eternal", n = 0) =>
  CARDS.filter((c) => c.rarity === rarity)[n];
const save = async (name: string, buffer: Buffer) => {
  await writeFile(`${outDir}${name}`, buffer);
  console.log(`${name}  ${(buffer.length / 1024).toFixed(0)} KB`);
};

await save(
  "card-single.png",
  await renderer.cards([{ def: byRarity("eternal"), variant: "purple" }], {
    scale: 2,
  }),
);
await save(
  "daily.png",
  await renderer.cards([
    { def: byRarity("common", 3), variant: "metal", badge: "NEW" },
    { def: byRarity("bargain", 2), variant: "blue", badge: "Blue" },
    { def: byRarity("eternal", 4), variant: "red", badge: "Red" },
  ]),
);

// A battle a few rounds in: the AI plays both sides until the board has some cards, then we pick one in hand.
const rng = mulberry32(21);
let state: GameState = newGame(
  { bottom: CARDS.slice(0, 12), top: CARDS.slice(3, 15) },
  "top",
  rng,
).state;
state = playAiTurn(state, "normal", rng).state; // top plays and ends its turn
for (let round = 0; round < 3; round++) {
  const mine = legalPlays(state).slice(0, 2);
  for (const play of mine)
    if (
      legalPlays(state).some((p) => p.uid === play.uid && p.lane === play.lane)
    )
      state = playCard(state, play.uid, play.lane).state;
  state = endTurn(state, rng).state; // you end, round resolves
  state = playAiTurn(state, "hard", rng).state;
}
const selected = state.players.bottom.hand[1]?.uid ?? null;
await save(
  "battle.png",
  await renderer.battle({
    state,
    viewer: "bottom",
    selectedUid: selected,
    variants: Object.fromEntries(
      CARDS.slice(0, 6).map((c, i) => [
        c.id,
        ["metal", "blue", "purple", "red"][i % 4],
      ]),
    ),
  }),
);
await save(
  "battle-victory.png",
  await renderer.battle({
    state: { ...state, winner: "bottom" },
    viewer: "bottom",
  }),
);

// The story: the map at the crossroads, and the book with a starter set (2 eternal, 2 bargain, 8 common).
await save(
  "story-map.png",
  await renderer.map({
    locations: [
      { id: "wisdom", name: "The Eyes Of Wisdom", x: 0.16, y: 0.5 },
      { id: "crossroads", name: "The Crossroads", x: 0.5, y: 0.5, here: true },
      { id: "tribe", name: "Bò Tuôi", x: 0.84, y: 0.5 },
    ],
    links: [
      ["crossroads", "wisdom"],
      ["crossroads", "tribe"],
    ],
  }),
);
await save(
  "story-book.png",
  await renderer.pack(drawStarterPack(CARDS, mulberry32(12))),
);

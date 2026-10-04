// Renders sample images to ./preview so you can check the look without Discord. Run: npm run preview
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CARDS, CARD_INDEX } from '../src/data/cards';
import { playAiTurn } from '../src/engine/ai';
import { endTurn, legalPlays, newGame, playCard } from '../src/engine/rules';
import type { GameState } from '../src/engine/types';
import { createImageRenderer } from '../src/render/renderer';
import { mulberry32 } from '../src/util/rng';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = `${root}preview/`;
await mkdir(outDir, { recursive: true });

const renderer = await createImageRenderer({ assetsDir: `${root}assets` });
const card = (id: string) => CARD_INDEX.get(id)!;
const save = async (name: string, buffer: Buffer) => {
  await writeFile(`${outDir}${name}`, buffer);
  console.log(`${name}  ${(buffer.length / 1024).toFixed(0)} KB`);
};

await save('card-single.png', await renderer.cards([{ def: card('phuong-hoang'), tier: 3 }], { scale: 2 }));
await save('daily.png', await renderer.cards([
  { def: card('tho-lua'), tier: 1, badge: 'NEW' },
  { def: card('ho-rung'), tier: 2, badge: 'TIER 2' },
  { def: card('co-thu'), tier: 5, badge: 'TIER 5' },
]));

// A battle a few rounds in: the AI plays both sides until the board has some cards, then we pick one in hand.
const rng = mulberry32(21);
let state: GameState = newGame({ bottom: CARDS.slice(0, 12), top: CARDS.slice(3, 15) }, 'top', rng).state;
state = playAiTurn(state, 'normal', rng).state; // top plays and ends its turn
for (let round = 0; round < 3; round++) {
  const mine = legalPlays(state).slice(0, 2);
  for (const play of mine) if (legalPlays(state).some((p) => p.uid === play.uid && p.lane === play.lane)) state = playCard(state, play.uid, play.lane).state;
  state = endTurn(state).state; // you end, round resolves
  state = playAiTurn(state, 'hard', rng).state;
}
const selected = state.players.bottom.hand[1]?.uid ?? null;
await save('battle.png', await renderer.battle({ state, viewer: 'bottom', selectedUid: selected, tiers: { 'tho-lua': 3, 'cao-than': 2 } }));
await save('battle-victory.png', await renderer.battle({ state: { ...state, winner: 'bottom' }, viewer: 'bottom' }));

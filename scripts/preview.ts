// Renders sample images to ./preview so you can check the look without Discord. Run: npm run preview
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CARDS, CARD_INDEX } from '../src/data/cards';
import { createBattle, resolveTurn } from '../src/engine/battle';
import { createFighter } from '../src/engine/fighter';
import { createImageRenderer } from '../src/render/renderer';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = `${root}preview/`;
await mkdir(outDir, { recursive: true });

const renderer = await createImageRenderer({ assetsDir: `${root}assets`, cards: CARDS });
const card = (id: string) => CARD_INDEX.get(id)!;
const save = async (name: string, buffer: Buffer) => {
  await writeFile(`${outDir}${name}`, buffer);
  console.log(`${name}  ${(buffer.length / 1024).toFixed(0)} KB`);
};

await save('card-single.png', await renderer.cards([{ def: card('phuong-hoang'), level: 3 }], { scale: 1.2 }));
await save(
  'daily.png',
  await renderer.cards(
    [
      { def: card('tho-lua'), level: 1, badge: 'NEW' },
      { def: card('long-vuong'), level: 2, badge: 'LV 2' },
      { def: card('co-thu'), level: 5, badge: 'MAX' },
    ],
    { scale: 0.9 },
  ),
);

// A mid-battle state: damage, a shield, one knocked-out fighter.
const team = (ids: string[], level: number) => ids.map((id) => createFighter(card(id), level));
let battle = createBattle(team(['phuong-hoang', 'ca-chep', 'nam-con'], 3), team(['thuy-quai', 'su-tu-dung-nham', 'ho-rung'], 3));
battle.player.fighters[0].hp = 96;
battle.player.fighters[0].shield = 40;
battle.enemy.fighters[1].hp = 0;
battle.turn = 5;
await save('battle.png', await renderer.battle(battle));

// And a finished one.
battle = resolveTurn(battle, { type: 'skill', index: 0 }, { type: 'skill', index: 0 }).battle;
battle.winner = 'player';
await save('battle-victory.png', await renderer.battle(battle));

import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CARDS } from '../src/data/cards';
import { createBattle } from '../src/engine/battle';
import { createFighter } from '../src/engine/fighter';
import { renderBattle, renderBattleEnd } from '../src/discord/battle-view';
import type { AppContext } from '../src/discord/command';
import { tryRender } from '../src/discord/images';
import { createImageRenderer } from '../src/render/renderer';

const REAL_ASSETS = join(__dirname, '..', 'assets');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const size = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

/** Temp assets folder with the real fonts and an empty cards/ folder we can drop art into. */
async function tempAssets() {
  const dir = await mkdtemp(join(tmpdir(), 'assets-'));
  await cp(join(REAL_ASSETS, 'fonts'), join(dir, 'fonts'), { recursive: true });
  await mkdir(join(dir, 'cards'));
  return dir;
}

async function solidPng(color: string, width = 400, height = 300): Promise<Buffer> {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return canvas.toBuffer('image/png');
}

afterEach(() => vi.restoreAllMocks());

describe('image renderer', () => {
  it('draws every card as a valid PNG of the expected size', async () => {
    const renderer = await createImageRenderer({ assetsDir: REAL_ASSETS, cards: CARDS });
    for (const def of CARDS) {
      const png = await renderer.cards([{ def, level: 3 }]);
      expect(png.subarray(0, 8).equals(PNG_SIGNATURE), def.id).toBe(true);
      expect(size(png), def.id).toEqual({ width: 300 + 28, height: 420 + 28 });
    }
    const row = await renderer.cards(CARDS.slice(0, 3).map((def) => ({ def, level: 1, badge: 'NEW' })), { scale: 0.9 });
    expect(size(row)).toEqual({ width: 3 * 270 + 4 * 14, height: 378 + 28 });
  });

  it('renders battle scenes quickly, including KO, shield and a finished battle', async () => {
    const renderer = await createImageRenderer({ assetsDir: REAL_ASSETS, cards: CARDS });
    const team = (offset: number) => CARDS.slice(offset, offset + 3).map((c) => createFighter(c, 5));
    const battle = createBattle(team(0), team(5));
    battle.player.fighters[0].shield = 30;
    battle.enemy.fighters[1].hp = 0;

    const started = performance.now();
    const png = await renderer.battle(battle);
    battle.winner = 'player';
    const done = await renderer.battle(battle);
    const perImage = (performance.now() - started) / 2;

    expect(size(png)).toEqual({ width: 740, height: 624 });
    expect(done.length).toBeGreaterThan(0);
    expect(png.length).toBeLessThan(2 * 1024 * 1024); // far under Discord's upload limit
    expect(perImage).toBeLessThan(1000); // Discord wants an answer within 3 seconds
  });

  it('uses real art when a file exists and picks up replaced files without a restart', async () => {
    const assetsDir = await tempAssets();
    const renderer = await createImageRenderer({ assetsDir, cards: CARDS });
    const def = CARDS[0];
    const view = [{ def, level: 1 }];

    const placeholder = await renderer.cards(view);
    await writeFile(join(assetsDir, 'cards', `${def.id}.png`), await solidPng('#ff00ff'));
    const withArt = await renderer.cards(view);
    expect(withArt.equals(placeholder)).toBe(false);

    await writeFile(join(assetsDir, 'cards', `${def.id}.png`), await solidPng('#00ffff', 500, 500));
    const replaced = await renderer.cards(view);
    expect(replaced.equals(withArt)).toBe(false);
  });

  it('survives a corrupt art file by showing the placeholder', async () => {
    const assetsDir = await tempAssets();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const renderer = await createImageRenderer({ assetsDir, cards: CARDS });
    const def = CARDS[1];
    const placeholder = await renderer.cards([{ def, level: 1 }]);

    await writeFile(join(assetsDir, 'cards', `${def.id}.png`), 'this is not an image');
    const png = await renderer.cards([{ def, level: 1 }]);
    expect(png.equals(placeholder)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    await renderer.cards([{ def, level: 1 }]);
    expect(warn).toHaveBeenCalledTimes(1); // not spammed on every render
  });

  it('refuses to start without the bundled fonts', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'nofonts-'));
    await expect(createImageRenderer({ assetsDir: empty, cards: CARDS })).rejects.toThrow(/font/);
  });
});

describe('tryRender fallback', () => {
  const ctxWith = (images: AppContext['images']) => ({ images }) as AppContext;

  it('returns null when images are unavailable', async () => {
    expect(await tryRender(ctxWith(null), async () => Buffer.from('x'))).toBeNull();
  });

  it('returns null instead of throwing when rendering fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = { cards: async () => Buffer.alloc(0), battle: async () => Buffer.alloc(0) };
    expect(
      await tryRender(ctxWith(broken), async () => {
        throw new Error('boom');
      }),
    ).toBeNull();
  });
});

describe('battle view with and without an image', () => {
  const team = () => CARDS.slice(0, 3).map((c) => createFighter(c, 1));
  const battle = createBattle(team(), team());
  const image = Buffer.from('png');

  it('image mode attaches the picture and keeps only the log in the embed', () => {
    const view = renderBattle(battle, ['x'], 'abc', image);
    expect(view.files).toHaveLength(1);
    const embed = view.embeds[0].toJSON();
    expect(embed.fields ?? []).toHaveLength(0);
    expect(embed.description).toBe('x');
    expect(renderBattleEnd({ ...battle, winner: 'player' }, ['x'], 'won', image).files).toHaveLength(1);
  });

  it('text mode has no attachment and lists both teams', () => {
    const view = renderBattle(battle, [], 'abc');
    expect(view.files).toHaveLength(0);
    expect(view.embeds[0].toJSON().fields!.map((f) => f.name)).toEqual(['You', 'Enemy', 'Last turn']);
  });

  it('uses a new file name each turn so Discord never shows a cached image', () => {
    const next = { ...battle, turn: battle.turn + 1 };
    const a = renderBattle(battle, [], 'abc', image).files[0].name;
    const b = renderBattle(next, [], 'abc', image).files[0].name;
    expect(a).not.toBe(b);
  });
});

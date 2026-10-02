import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARDS, CARD_INDEX } from '../src/data/cards';
import { JsonPlayerRepo } from '../src/db/json-repo';
import { claimDaily, drawPack, todayKey } from '../src/game/gacha';
import { DUPLICATE_COINS, createPlayer, grantCard } from '../src/game/player';
import { applyBattleResult, generateEnemyTeam } from '../src/game/pve';
import { resolveTeam } from '../src/game/team';
import { mulberry32 } from '../src/util/rng';

describe('card data', () => {
  it('is well formed', () => {
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
    for (const c of CARDS) {
      expect(c.skills, c.id).toHaveLength(3);
      expect(c.skills[0].kind, c.id).toBe('attack');
      expect(c.skills[0].cooldown, c.id).toBe(0); // always something legal to do
    }
    for (const element of ['fire', 'water', 'grass']) {
      expect(CARDS.filter((c) => c.element === element)).toHaveLength(5);
    }
  });
});

describe('drawPack', () => {
  it('returns distinct cards', () => {
    for (let seed = 0; seed < 50; seed++) {
      const pack = drawPack(CARDS, mulberry32(seed));
      expect(new Set(pack.map((c) => c.id)).size).toBe(3);
    }
  });

  it('respects rarity weights roughly', () => {
    const rng = mulberry32(42);
    const counts = { common: 0, rare: 0, epic: 0, legendary: 0 };
    const n = 4000;
    for (let i = 0; i < n; i++) counts[drawPack(CARDS, rng, 1)[0].rarity]++;
    expect(counts.common / n).toBeGreaterThan(0.5);
    expect(counts.legendary / n).toBeGreaterThan(0.005);
    expect(counts.legendary / n).toBeLessThan(0.05);
  });
});

describe('grantCard', () => {
  it('new -> level up -> max converts to coins', () => {
    const player = createPlayer('u');
    const card = CARDS[0];
    expect(grantCard(player, card).kind).toBe('new');
    for (let level = 2; level <= 5; level++) {
      const result = grantCard(player, card);
      expect(result.kind).toBe('levelup');
      expect(result.level).toBe(level);
    }
    const maxed = grantCard(player, card);
    expect(maxed.kind).toBe('maxed');
    expect(player.cards[card.id]).toBe(5);
    expect(player.coins).toBe(DUPLICATE_COINS);
  });
});

describe('claimDaily', () => {
  it('works once per day and gives a playable team on day one', () => {
    const player = createPlayer('u');
    const rng = mulberry32(3);
    expect(claimDaily(player, CARDS, '2026-10-02', rng).ok).toBe(true);
    expect(claimDaily(player, CARDS, '2026-10-02', rng).ok).toBe(false);
    expect(Object.keys(player.cards)).toHaveLength(3);
    expect(resolveTeam(player, CARD_INDEX)).toHaveLength(3);
    expect(claimDaily(player, CARDS, '2026-10-03', rng).ok).toBe(true);
  });

  it('todayKey uses the given timezone', () => {
    const instant = new Date('2026-10-01T20:00:00Z'); // 03:00 on Oct 2 in Vietnam
    expect(todayKey(instant, 'Asia/Ho_Chi_Minh')).toBe('2026-10-02');
    expect(todayKey(instant, 'UTC')).toBe('2026-10-01');
  });
});

describe('resolveTeam', () => {
  it('is null with fewer than 3 cards', () => {
    const player = createPlayer('u');
    grantCard(player, CARDS[0]);
    expect(resolveTeam(player, CARD_INDEX)).toBeNull();
  });

  it('uses the saved team when valid, ignores it when it references unowned cards', () => {
    const player = createPlayer('u');
    for (const c of CARDS.slice(0, 5)) grantCard(player, c);
    player.team = [CARDS[4].id, CARDS[3].id, CARDS[2].id];
    expect(resolveTeam(player, CARD_INDEX)!.map((m) => m.def.id)).toEqual(player.team);
    player.team = [CARDS[4].id, CARDS[3].id, 'not-owned'];
    expect(resolveTeam(player, CARD_INDEX)).toHaveLength(3);
  });

  it('auto-picks the rarest cards', () => {
    const player = createPlayer('u');
    for (const c of CARDS) grantCard(player, c);
    const picked = resolveTeam(player, CARD_INDEX)!;
    expect(picked.every((m) => m.def.rarity === 'legendary')).toBe(true);
  });
});

describe('PvE', () => {
  it('builds a 3-card enemy team at the difficulty level', () => {
    const team = generateEnemyTeam(CARDS, 'hard', mulberry32(1));
    expect(team).toHaveLength(3);
    expect(new Set(team.map((f) => f.cardId)).size).toBe(3);
    expect(team.every((f) => f.level === 5)).toBe(true);
  });

  it('records results and awards coins', () => {
    const player = createPlayer('u');
    expect(applyBattleResult(player, 'hard', true)).toBe(80);
    expect(applyBattleResult(player, 'easy', false)).toBe(5);
    expect(player).toMatchObject({ wins: 1, losses: 1, coins: 85 });
  });
});

describe('JsonPlayerRepo', () => {
  it('persists across reopen and returns copies', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cardbot-'));
    const path = join(dir, 'nested', 'players.json');
    const repo = await JsonPlayerRepo.open(path);
    const player = repo.get('u1');
    expect(player.coins).toBe(0);
    player.coins = 99;
    expect(repo.get('u1').coins).toBe(0); // not saved yet
    await repo.save(player);
    await repo.flush();

    const reopened = await JsonPlayerRepo.open(path);
    expect(reopened.get('u1').coins).toBe(99);
    expect(JSON.parse(await readFile(path, 'utf8')).players.u1.coins).toBe(99);
  });

  it('serializes concurrent saves; the last one wins', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cardbot-'));
    const path = join(dir, 'players.json');
    const repo = await JsonPlayerRepo.open(path);
    const saves = [1, 2, 3, 4, 5].map((n) => {
      const p = repo.get('u');
      p.coins = n;
      return repo.save(p);
    });
    await Promise.all(saves);
    expect((await JsonPlayerRepo.open(path)).get('u').coins).toBe(5);
  });

  it('refuses to start on a corrupt file instead of wiping it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cardbot-'));
    const path = join(dir, 'players.json');
    await writeFile(path, '{ not json');
    await expect(JsonPlayerRepo.open(path)).rejects.toThrow(/Could not read/);
    expect(await readFile(path, 'utf8')).toBe('{ not json');
  });
});

import { describe, expect, it } from 'vitest';
import {
  activeOf,
  calcDamage,
  createBattle,
  elementMultiplier,
  forfeit,
  isLegal,
  legalActions,
  resolveTurn,
} from '../src/engine/battle';
import { createFighter } from '../src/engine/fighter';
import { basic, def, fighter, heal, shieldSkill, strong } from './helpers';

describe('elementMultiplier', () => {
  it('fire > grass > water > fire', () => {
    expect(elementMultiplier('fire', 'grass')).toBe(1.5);
    expect(elementMultiplier('grass', 'water')).toBe(1.5);
    expect(elementMultiplier('water', 'fire')).toBe(1.5);
    expect(elementMultiplier('grass', 'fire')).toBe(0.5);
    expect(elementMultiplier('fire', 'water')).toBe(0.5);
    expect(elementMultiplier('fire', 'fire')).toBe(1);
  });
});

describe('calcDamage', () => {
  it('applies power, defense and element', () => {
    const a = fighter({ atk: 50 });
    const same = fighter({ def: 100 });
    expect(calcDamage(a, strong, same)).toBe(50); // 50*2*100/200
    const weak = fighter({ def: 100, element: 'grass' });
    expect(calcDamage(a, strong, weak)).toBe(75); // x1.5
  });

  it('never deals less than 1', () => {
    expect(calcDamage(fighter({ atk: 1 }), basic, fighter({ def: 10000 }))).toBe(1);
  });
});

describe('level scaling', () => {
  it('adds 10% per level and clamps to 1..5', () => {
    expect(createFighter(def({ hp: 100 }), 3).maxHp).toBe(120);
    expect(createFighter(def({ hp: 100 }), 99).maxHp).toBe(140);
    expect(createFighter(def({ hp: 100 }), 0).maxHp).toBe(100);
  });
});

describe('resolveTurn', () => {
  const skill0 = { type: 'skill', index: 0 } as const;

  it('faster fighter acts first and can knock out the slower one before it acts', () => {
    const battle = createBattle(
      [fighter({ atk: 400, spd: 50 }), fighter({ id: 'b' })],
      [fighter({ hp: 10, spd: 10 }), fighter({ id: 'c' })],
    );
    const { battle: after, log } = resolveTurn(battle, skill0, skill0);
    expect(after.player.fighters[0].hp).toBe(100); // enemy never got to attack
    expect(after.enemy.fighters[0].hp).toBe(0);
    expect(after.enemy.active).toBe(1); // next fighter auto-sent
    expect(after.winner).toBeNull();
    expect(log.some((l) => l.includes('fainted'))).toBe(true);
  });

  it('player acts first on equal speed', () => {
    const battle = createBattle([fighter({ atk: 400 })], [fighter({ hp: 10, atk: 400 })]);
    const { battle: after } = resolveTurn(battle, skill0, skill0);
    expect(after.winner).toBe('player');
    expect(after.player.fighters[0].hp).toBe(100);
  });

  it('switching happens before skills, so the new fighter takes the hit', () => {
    const battle = createBattle([fighter(), fighter({ id: 'b', name: 'B' })], [fighter({ atk: 100 })]);
    const { battle: after } = resolveTurn(battle, { type: 'switch', index: 1 }, skill0);
    expect(after.player.active).toBe(1);
    expect(after.player.fighters[0].hp).toBe(100);
    expect(after.player.fighters[1].hp).toBe(50); // 100*1/2 damage
  });

  it('enforces cooldowns: unavailable for N following turns', () => {
    let battle = createBattle([fighter({ hp: 10000 })], [fighter({ hp: 10000 })]);
    const useStrong = { type: 'skill', index: 1 } as const;
    battle = resolveTurn(battle, useStrong, skill0).battle; // turn 1: use (cooldown 2)
    expect(isLegal(battle, 'player', useStrong)).toBe(false); // turn 2
    battle = resolveTurn(battle, skill0, skill0).battle;
    expect(isLegal(battle, 'player', useStrong)).toBe(false); // turn 3
    battle = resolveTurn(battle, skill0, skill0).battle;
    expect(isLegal(battle, 'player', useStrong)).toBe(true); // turn 4
  });

  it('shield absorbs damage before HP', () => {
    const tank = fighter({ hp: 100, skills: [basic, strong, shieldSkill] });
    const battle = createBattle([tank], [fighter({ atk: 100 })]); // 50 dmg per basic
    const s1 = resolveTurn(battle, { type: 'skill', index: 2 }, skill0).battle;
    // shield 30 raised first? enemy spd == player spd, player first -> shield up, then hit 50
    expect(s1.player.fighters[0].shield).toBe(0);
    expect(s1.player.fighters[0].hp).toBe(80); // 50 - 30 absorbed = 20 lost
  });

  it('heal is capped at max HP', () => {
    const healer = fighter({ hp: 100, skills: [basic, strong, heal] });
    healer.hp = 80;
    const battle = createBattle([healer], [fighter({ atk: 2 })]); // 1 dmg
    const after = resolveTurn(battle, { type: 'skill', index: 2 }, skill0).battle;
    expect(after.player.fighters[0].hp).toBe(99); // healed to 100, then -1
  });

  it('declares the winner when the last fighter falls', () => {
    const battle = createBattle([fighter({ atk: 400 })], [fighter({ hp: 10 })]);
    const { battle: after } = resolveTurn(battle, skill0, skill0);
    expect(after.winner).toBe('player');
    expect(() => resolveTurn(after, skill0, skill0)).toThrow();
  });

  it('rejects illegal actions and does not mutate its input', () => {
    const battle = createBattle([fighter()], [fighter()]);
    const snapshot = structuredClone(battle);
    expect(() => resolveTurn(battle, { type: 'switch', index: 0 }, skill0)).toThrow();
    expect(() => resolveTurn(battle, { type: 'skill', index: 7 }, skill0)).toThrow();
    resolveTurn(battle, skill0, skill0);
    expect(battle).toEqual(snapshot);
  });

  it('cannot switch to a knocked-out fighter', () => {
    const battle = createBattle([fighter(), fighter({ id: 'b' })], [fighter()]);
    battle.player.fighters[1].hp = 0;
    expect(legalActions(battle, 'player').some((a) => a.type === 'switch')).toBe(false);
  });
});

describe('forfeit', () => {
  it('gives the win to the other side', () => {
    const battle = createBattle([fighter()], [fighter()]);
    expect(forfeit(battle, 'player').winner).toBe('enemy');
    expect(activeOf(battle, 'player').hp).toBe(100);
  });
});

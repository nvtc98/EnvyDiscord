import { createFighter } from '../src/engine/fighter';
import type { CardDef, Element, Fighter, Skill } from '../src/engine/types';

export const basic: Skill = { name: 'Basic attack', kind: 'attack', power: 1, cooldown: 0 };
export const strong: Skill = { name: 'Strong attack', kind: 'attack', power: 2, cooldown: 2 };
export const heal: Skill = { name: 'Heal', kind: 'heal', power: 0.5, cooldown: 3 };
export const shieldSkill: Skill = { name: 'Shield', kind: 'shield', power: 0.3, cooldown: 3 };

export function def(overrides: Partial<CardDef> = {}): CardDef {
  return {
    id: 'test',
    name: 'Test',
    element: 'fire' as Element,
    rarity: 'common',
    hp: 100,
    atk: 50,
    def: 100, // def 100 => damage = atk * power / 2
    spd: 30,
    skills: [basic, strong, heal],
    ...overrides,
  };
}

export function fighter(overrides: Partial<CardDef> = {}, level = 1): Fighter {
  return createFighter(def(overrides), level);
}

import type { CardDef, Fighter } from './types';

export const MAX_LEVEL = 5;
const BONUS_PER_LEVEL = 0.1;

export function createFighter(def: CardDef, level: number): Fighter {
  const lv = Math.min(Math.max(1, level), MAX_LEVEL);
  const scale = 1 + BONUS_PER_LEVEL * (lv - 1);
  const maxHp = Math.round(def.hp * scale);
  return {
    cardId: def.id,
    name: def.name,
    element: def.element,
    level: lv,
    maxHp,
    hp: maxHp,
    atk: Math.round(def.atk * scale),
    def: Math.round(def.def * scale),
    spd: Math.round(def.spd * scale),
    skills: def.skills.map((s) => ({ ...s })),
    cooldowns: def.skills.map(() => 0),
    shield: 0,
  };
}

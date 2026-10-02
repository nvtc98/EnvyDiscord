export type Element = 'fire' | 'water' | 'grass';
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type SkillKind = 'attack' | 'heal' | 'shield';

export interface Skill {
  name: string;
  kind: SkillKind;
  /** attack: damage multiplier on ATK. heal/shield: fraction of max HP. */
  power: number;
  /** Turns the skill is unavailable after use. skills[0] must always be 0. */
  cooldown: number;
}

export interface CardDef {
  id: string;
  name: string;
  element: Element;
  rarity: Rarity;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  skills: Skill[];
}

export interface Fighter {
  cardId: string;
  name: string;
  element: Element;
  level: number;
  maxHp: number;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  skills: Skill[];
  /** Remaining unavailable turns per skill, same indexes as skills. */
  cooldowns: number[];
  shield: number;
}

export interface Side {
  fighters: Fighter[];
  active: number;
}

export type SideId = 'player' | 'enemy';

export interface Battle {
  player: Side;
  enemy: Side;
  turn: number;
  winner: SideId | null;
}

export type Action = { type: 'skill'; index: number } | { type: 'switch'; index: number };

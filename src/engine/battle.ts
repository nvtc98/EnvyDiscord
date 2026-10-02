import type { Action, Battle, Element, Fighter, Side, SideId, Skill } from './types';

const SIDES: SideId[] = ['player', 'enemy'];

export const opponentOf = (id: SideId): SideId => (id === 'player' ? 'enemy' : 'player');
const label = (id: SideId) => (id === 'player' ? 'You' : 'Enemy');

export const activeOf = (battle: Battle, id: SideId): Fighter => battle[id].fighters[battle[id].active];

/** Fire > Grass > Water > Fire. */
export function elementMultiplier(attacker: Element, defender: Element): number {
  if (attacker === defender) return 1;
  const beats: Record<Element, Element> = { fire: 'grass', grass: 'water', water: 'fire' };
  return beats[attacker] === defender ? 1.5 : 0.5;
}

export function calcDamage(attacker: Fighter, skill: Skill, defender: Fighter): number {
  const raw = ((attacker.atk * skill.power * 100) / (100 + defender.def)) * elementMultiplier(attacker.element, defender.element);
  return Math.max(1, Math.round(raw));
}

export function createBattle(playerTeam: Fighter[], enemyTeam: Fighter[]): Battle {
  if (playerTeam.length === 0 || enemyTeam.length === 0) throw new Error('Each side needs at least one card');
  const side = (fighters: Fighter[]): Side => ({ fighters, active: 0 });
  return { player: side(playerTeam), enemy: side(enemyTeam), turn: 1, winner: null };
}

export function legalActions(battle: Battle, id: SideId): Action[] {
  if (battle.winner) return [];
  const side = battle[id];
  const current = side.fighters[side.active];
  const actions: Action[] = [];
  current.skills.forEach((_, index) => {
    if (current.cooldowns[index] === 0) actions.push({ type: 'skill', index });
  });
  side.fighters.forEach((fighter, index) => {
    if (index !== side.active && fighter.hp > 0) actions.push({ type: 'switch', index });
  });
  return actions;
}

export function isLegal(battle: Battle, id: SideId, action: Action): boolean {
  return legalActions(battle, id).some((a) => a.type === action.type && a.index === action.index);
}

export interface TurnResult {
  battle: Battle;
  log: string[];
}

/** Resolves one simultaneous turn. Does not mutate `prev`. */
export function resolveTurn(prev: Battle, playerAction: Action, enemyAction: Action): TurnResult {
  if (prev.winner) throw new Error('The battle is already over');
  const actions: Record<SideId, Action> = { player: playerAction, enemy: enemyAction };
  for (const id of SIDES) {
    if (!isLegal(prev, id, actions[id])) throw new Error(`Illegal action for ${id}`);
  }

  const battle = structuredClone(prev);
  const log: string[] = [];

  // 1. Switches happen before any skill.
  for (const id of SIDES) {
    const action = actions[id];
    if (action.type === 'switch') {
      battle[id].active = action.index;
      log.push(`${label(id)} switched to ${activeOf(battle, id).name}.`);
    }
  }

  // 2. Skills, fastest first (player wins ties).
  const attackers = SIDES.flatMap((id) => {
    const action = actions[id];
    return action.type === 'skill' ? [{ id, fighter: activeOf(battle, id), index: action.index }] : [];
  }).sort((a, b) => b.fighter.spd - a.fighter.spd || (a.id === 'player' ? -1 : 1));

  for (const { id, fighter, index } of attackers) {
    if (battle.winner) break;
    if (fighter.hp <= 0) continue; // knocked out before it could act
    useSkill(battle, id, fighter, index, log);
  }

  // 3. End of turn.
  if (!battle.winner) {
    for (const id of SIDES) {
      for (const fighter of battle[id].fighters) {
        fighter.cooldowns = fighter.cooldowns.map((c) => Math.max(0, c - 1));
      }
    }
    battle.turn += 1;
  }

  return { battle, log };
}

export function forfeit(prev: Battle, id: SideId): Battle {
  const battle = structuredClone(prev);
  battle.winner = opponentOf(id);
  return battle;
}

function useSkill(battle: Battle, id: SideId, user: Fighter, index: number, log: string[]): void {
  const skill = user.skills[index];
  // +1 because the end-of-turn tick consumes one immediately.
  user.cooldowns[index] = skill.cooldown > 0 ? skill.cooldown + 1 : 0;
  const prefix = `${label(id)}: ${user.name} used **${skill.name}**`;

  if (skill.kind === 'heal') {
    const before = user.hp;
    user.hp = Math.min(user.maxHp, user.hp + Math.round(user.maxHp * skill.power));
    log.push(`${prefix}, healed ${user.hp - before} HP.`);
    return;
  }

  if (skill.kind === 'shield') {
    const amount = Math.round(user.maxHp * skill.power);
    user.shield = Math.max(user.shield, amount);
    log.push(`${prefix}, raised a shield of ${user.shield}.`);
    return;
  }

  const foeId = opponentOf(id);
  const target = activeOf(battle, foeId);
  const multiplier = elementMultiplier(user.element, target.element);
  const damage = calcDamage(user, skill, target);
  const absorbed = Math.min(target.shield, damage);
  target.shield -= absorbed;
  target.hp = Math.max(0, target.hp - (damage - absorbed));

  const note = multiplier > 1 ? ' Super effective!' : multiplier < 1 ? ' Not very effective.' : '';
  const shieldNote = absorbed > 0 ? ` (shield absorbed ${absorbed})` : '';
  log.push(`${prefix}, dealing ${damage} damage to ${target.name}.${note}${shieldNote}`);

  if (target.hp === 0) {
    log.push(`${target.name} fainted!`);
    sendNext(battle, foeId, log);
  }
}

function sendNext(battle: Battle, id: SideId, log: string[]): void {
  const side = battle[id];
  const next = side.fighters.findIndex((f) => f.hp > 0);
  if (next === -1) {
    battle.winner = opponentOf(id);
    return;
  }
  side.active = next;
  log.push(`${label(id)} sent out ${side.fighters[next].name}.`);
}

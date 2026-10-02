import { pick, type Rng } from '../util/rng';
import {
  activeOf,
  calcDamage,
  elementMultiplier,
  legalActions,
  opponentOf,
  resolveTurn,
} from './battle';
import type { Action, Battle, SideId } from './types';

export type Difficulty = 'easy' | 'normal' | 'hard';

export function chooseAction(battle: Battle, side: SideId, difficulty: Difficulty, rng: Rng): Action {
  const actions = legalActions(battle, side);
  if (actions.length === 0) throw new Error('No legal action available');
  if (difficulty === 'easy') return pick(actions.filter((a) => a.type === 'skill'), rng);
  if (difficulty === 'normal') {
    // A little noise so it is not perfectly predictable.
    if (rng() < 0.15) return pick(actions.filter((a) => a.type === 'skill'), rng);
    return best(actions, (a) => heuristic(battle, side, a));
  }
  return best(actions, (a) => worstCase(battle, side, a));
}

function best(actions: Action[], score: (a: Action) => number): Action {
  let top = actions[0];
  let topScore = -Infinity;
  for (const action of actions) {
    const s = score(action);
    if (s > topScore) {
      top = action;
      topScore = s;
    }
  }
  return top;
}

function heuristic(battle: Battle, side: SideId, action: Action): number {
  const me = activeOf(battle, side);
  const foe = activeOf(battle, opponentOf(side));

  if (action.type === 'switch') {
    const candidate = battle[side].fighters[action.index];
    const badMatchup = elementMultiplier(foe.element, me.element) > 1;
    const goodMatchup = elementMultiplier(candidate.element, foe.element) > 1;
    return badMatchup && goodMatchup ? 20 : -1;
  }

  const skill = me.skills[action.index];
  if (skill.kind === 'attack') {
    const damage = calcDamage(me, skill, foe);
    return damage >= foe.hp + foe.shield ? 1000 : damage;
  }
  if (skill.kind === 'heal') {
    const missing = me.maxHp - me.hp;
    return me.hp / me.maxHp < 0.4 ? Math.min(missing, me.maxHp * skill.power) * 1.5 : 0;
  }
  return me.shield === 0 ? me.maxHp * skill.power * 0.5 : 0;
}

/** One-ply minimax: assume the opponent picks the reply that hurts us most. */
function worstCase(battle: Battle, side: SideId, action: Action): number {
  const replies = legalActions(battle, opponentOf(side));
  let worst = Infinity;
  for (const reply of replies) {
    const result =
      side === 'player'
        ? resolveTurn(battle, action, reply).battle
        : resolveTurn(battle, reply, action).battle;
    worst = Math.min(worst, evaluate(result, side));
  }
  return worst;
}

function evaluate(battle: Battle, side: SideId): number {
  if (battle.winner) return battle.winner === side ? 10 : -10;
  return hpFraction(battle, side) - hpFraction(battle, opponentOf(side));
}

function hpFraction(battle: Battle, side: SideId): number {
  const fighters = battle[side].fighters;
  const hp = fighters.reduce((sum, f) => sum + f.hp + f.shield * 0.5, 0);
  const max = fighters.reduce((sum, f) => sum + f.maxHp, 0);
  return hp / max;
}

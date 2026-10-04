import type { Ability, CardDef } from './types';

/** Plain-English description of an ability, used as the card's rules text unless the card sets its own. */
export function abilityText(ability: Ability | undefined): string {
  if (!ability) return '';
  const { timing, effect } = ability;
  const s = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (timing === 'active') {
    switch (effect.kind) {
      case 'heal': return `Active: heal ${effect.amount} HP.`;
      case 'damage': return `Active: deal ${effect.amount} damage to the opponent.`;
      case 'draw': return `Active: draw ${s(effect.count, 'card')}.`;
      case 'energy': return `Active: gain ${effect.amount} energy this turn.`;
      case 'buffLane': return `Active: your other cards in this lane get +${effect.amount} power.`;
    }
  }
  if (timing === 'continuous') {
    return effect.kind === 'laneDouble'
      ? 'Passive: your cards in this lane deal double damage.'
      : 'Passive: this lane cannot be pushed.';
  }
  return `Passive: at the end of each round, heal ${effect.amount} HP.`;
}

export const cardText = (card: CardDef): string => card.text ?? abilityText(card.ability);

export const hasContinuous = (card: CardDef, kind: 'laneDouble' | 'anchor'): boolean =>
  card.ability?.timing === 'continuous' && card.ability.effect.kind === kind;

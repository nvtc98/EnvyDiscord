import type { Ability, CardDef } from "./types";

/** Plain-English description of an ability, used as the card's rules text unless the card sets its own. */
export function abilityText(ability: Ability | undefined): string {
  if (!ability) return "";
  const { timing, effect } = ability;
  const s = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (timing === "active") {
    switch (effect.kind) {
      case "draw":
        return `Active: draw ${s(effect.count, "card")}.`;
      case "energy":
        return `Active: gain ${effect.amount} energy this turn.`;
      case "buffLane":
        return `Active: your other cards in this lane get +${effect.amount} power.`;
      case "destroyedPower":
        return "Active: gain power equal to the total power of all cards destroyed this match.";
      case "shield":
        return "Active: cannot be pushed by the enemy until the end of their next turn.";
      case "pushLane":
        return "Active: push this lane one step away from you; cards forced off the edge are destroyed.";
      case "destroyLane":
        return "Active: destroy every other card in this lane.";
    }
  }
  if (timing === "continuous") {
    switch (effect.kind) {
      case "laneDouble":
        return "Passive: your cards in this lane deal double damage.";
      case "anchor":
        return "Passive: this lane cannot be pushed.";
      case "drainStartOfTurn":
        return `Passive: at the start of each turn, every other card loses ${effect.amount} power.`;
    }
  }
  if (timing === "endOfRound") {
    switch (effect.kind) {
      case "oceanReturn":
        return `Passive: at the end of the round, give allies +${effect.amount} power, then shuffle back into your deck.`;
    }
  }
  // onDestroy
  return `Passive: when destroyed, return to your hand with +${effect.amount} power.`;
}

export const cardText = (card: CardDef): string =>
  card.text ?? abilityText(card.ability);

export const hasContinuous = (
  card: CardDef,
  kind: "laneDouble" | "anchor",
): boolean =>
  card.ability?.timing === "continuous" && card.ability.effect.kind === kind;

export const hasOnDestroy = (card: CardDef): boolean =>
  card.ability?.timing === "onDestroy";

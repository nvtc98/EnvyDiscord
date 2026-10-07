import { assertNever, type Ability, type CardDef, type Faction } from "./types";

/** Plain-English description of an ability, used as the card's rules text unless the card sets its own. */
export function abilityText(ability: Ability | undefined): string {
  if (!ability) return "";
  const { timing, effect } = ability;
  const s = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (timing === "active") {
    switch (effect.kind) {
      case "draw":
        return `Active: Draw ${s(effect.count, "card")}.`;
      case "energy":
        return `Active: Gain ${effect.amount} energy this turn.`;
      case "buffLane":
        return `Active: Your other cards in this lane get +${effect.amount} power.`;
      case "destroyedPower":
        return "Active: Gain power equal to the total power of all cards destroyed this match.";
      case "shield":
        return "Active: Cannot be pushed by the enemy until the end of their next turn.";
      case "pushLane":
        return "Active: Push this lane one step away from you; cards forced off the edge are destroyed.";
      case "destroyLane":
        return "Active: Destroy every other card in this lane.";
    }
  }
  if (timing === "continuous") {
    switch (effect.kind) {
      case "laneDouble":
        return "Passive: Your cards in this lane deal double damage.";
      case "anchor":
        return "Passive: This lane cannot be pushed.";
      case "drainStartOfTurn":
        return `Passive: At the start of each turn, every other card loses ${effect.amount} power.`;
      case "transformAt":
        return `Passive: When ${s(effect.count, "card")} ${effect.count === 1 ? "has" : "have"} been destroyed this match, transform.`;
      case "balanceCoefficient":
        return effect.k === 1
          ? "Passive: Swings The Tide normally."
          : `Passive: Swings The Tide ${effect.k} times harder.`;
      default:
        return assertNever(effect);
    }
  }
  if (timing === "endOfRound") {
    switch (effect.kind) {
      case "oceanReturn":
        return `Passive: At the end of the round, give allies +${effect.amount} power, then shuffle back into your deck.`;
    }
  }
  // onDestroy
  return `Passive: When destroyed, return to your hand with +${effect.amount} power.`;
}

export const cardText = (card: CardDef): string =>
  card.text ?? abilityText(card.ability);

/** A card's faction, defaulting to "the-eyes" for hand-built literals that omit it (§1). */
export const cardFaction = (def: CardDef): Faction => def.faction ?? "the-eyes";

export const hasContinuous = (
  card: CardDef,
  kind: "laneDouble" | "anchor",
): boolean =>
  card.ability?.timing === "continuous" && card.ability.effect.kind === kind;

export const hasOnDestroy = (card: CardDef): boolean =>
  card.ability?.timing === "onDestroy";

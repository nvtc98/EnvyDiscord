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
      case "pushLane":
        return "Active: Push this lane one step away from you; cards forced off the edge are destroyed.";
      case "destroyLane":
        return "Active: Destroy every other card in this lane.";
      case "shuffleRedraw":
        return "Active: Shuffle your hand into your deck, then draw that many cards.";
      case "buffRowAll":
        // No "other": Oracle buffs the whole row including itself (design Part 2).
        return `Active: Every card in this row gets +${effect.amount} power.`;
      case "cloneBoard":
        return "Active: Place a copy of this card into every empty cell on the board.";
      case "cloneLane":
        return "Active: Place a copy of this card into every empty cell in this lane.";
      case "cloneMirror":
        return "Active: If played in a side lane, place a copy of this card in the other side lane.";
      case "nexusSum":
        return "Active: If played in the middle lane, gain power equal to the two cards beside it in the same row.";
      case "gentlePush":
        return `Active: At the end of your turn, push The Eye Privilege ${effect.percent}% toward the enemy for each of your other passive cards on the board.`;
      default:
        // Compiler belt: the active switch previously had no default and fell through to the
        // continuous block, leaving the two cases above unenforced. assertNever forces every
        // active kind to be handled here.
        return assertNever(effect);
    }
  }
  if (timing === "onPlay") {
    // OnPlayEffect has a single kind (earlyBuff). TS 7 does not narrow a single-member
    // discriminated type to `never` in a switch/if default, so `assertNever` cannot be used
    // here; the typed `effect.kind` literal still forces any future kind to be handled.
    return `Passive: If played by turn ${effect.byTurn}, gain +${effect.amount} power.`;
  }
  if (timing === "continuous") {
    switch (effect.kind) {
      case "laneDouble":
        return "Passive: Your cards in this lane deal double damage.";
      case "anchor":
        return "Passive: This lane cannot be pushed.";
      case "pushImmune":
        return "Passive: Cannot be destroyed by being pushed.";
      case "drainStartOfTurn":
        return `Passive: At the start of each turn, every other card loses ${effect.amount} power.`;
      case "transformAt":
        return `Passive: When ${s(effect.count, "card")} ${effect.count === 1 ? "has" : "have"} been destroyed this match, transform.`;
      case "balanceCoefficient":
        return effect.k === 1
          ? "Passive: Pulls The Eye Privilege normally."
          : `Passive: Pulls The Eye Privilege ${effect.k} times harder.`;
      case "phasing":
        return "Passive: When an enemy push would destroy this, slip to a random empty lane instead.";
      case "wicked":
        return "Passive: Whenever any card moves, this gains +1 power.";
      case "reflecting":
        return "Passive: When an enemy push displaces this, shove a random other lane one step.";
      case "costReduction":
        return effect.amount === 1
          ? "Passive: Your cards cost 1 less (minimum 0)."
          : `Passive: Your cards cost ${effect.amount} less (minimum 0).`;
      default:
        return assertNever(effect);
    }
  }
  if (timing === "endOfRound") {
    switch (effect.kind) {
      case "oceanReturn":
        return `Passive: At the end of your turn, shuffle back into your deck and give every card in your deck +${effect.amount} power, including this one.`;
      case "teamBuffEndOfTurn":
        return `Passive: At the end of every turn, give your other cards +${effect.amount} power.`;
      default:
        return assertNever(effect);
    }
  }
  // onDestroy
  switch (effect.kind) {
    case "rebirth":
      return `Passive: When destroyed, return to your hand with +${effect.amount} power.`;
    case "glacialSpawn":
      return `Passive: When pushed off the board, spawn a copy with ${effect.drop} less power into each of the other two lanes.`;
    default:
      return assertNever(effect);
  }
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

/** True if `card` carries the continuous `pushImmune` effect (Bedrock): never destroyed by a push. */
export const isPushImmune = (card: CardDef): boolean =>
  card.ability?.timing === "continuous" &&
  card.ability.effect.kind === "pushImmune";

export const hasOnDestroy = (card: CardDef): boolean =>
  card.ability?.timing === "onDestroy";

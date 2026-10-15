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
        return `Active: Push The Eyes Privilege ${effect.percent}% toward the enemy for each of your other passive cards on the board.`;
      case "watcherDig":
        return "Active: Draw from the top 3 cards of your deck — the weakest if left, the middle if center, the strongest if right.";
      case "moonlitSacrifice":
        return "Active: Destroy all cards in your hand and add their total power to a random friendly card on the board.";
      case "titanShift":
        return "Active: Move the other cards in this lane to another lane (as many as fit).";
      case "apexSwap":
        return "Active: Swap places with your frontmost card in this lane.";
      case "berserkKill":
        return "Active: Destroy the card directly in front of this one.";
      case "summonHand":
        return "Active: Summon a random card from your hand to the space in front of this card.";
      case "summonDeck":
        return "Active: Summon a random card from your deck to the space in front of this card.";
      case "vaporSummon":
        return "Active: Vanish, then summon a random higher-cost card from your deck in its place.";
      case "chronosSummon":
        return "Active: Destroy the highest-cost card in your hand. If this is still alive after your next turn, summon that card in front of it.";
      case "evilHighest":
        return "Active: Give your highest-cost cards power equal to their cost.";
      case "joyfulBuff":
        return "Active: Give all your cards +1 power.";
      case "goliathGain":
        return "Active: Gain up to 10 power — more the more The Eyes Privilege favors the enemy.";
      case "frozenLock":
        return "Active: Next turn, no cards can be played — for either player.";
      case "gloomLane":
        return "Active: Enemy cards in this lane lose 1 power.";
      case "sunkenPull":
        return "Active: Pull the other two lanes one step toward you.";
      case "killingDeck":
        return "Active: Destroy a random card in the enemy's deck.";
      case "numbDeck":
        return "Active: Destroy a random card in your own deck.";
      case "sunlitScatter":
        return "Active: Destroy your other cards on the board and spread their total power randomly among the cards in your hand.";
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
          ? "Passive: Pulls The Eyes Privilege normally."
          : `Passive: Pulls The Eyes Privilege ${effect.k} times harder.`;
      case "phasing":
        return "Passive: When an enemy push would destroy this, slip to a random empty lane instead.";
      case "wicked":
        return "Passive: If this card moves during a turn, it gains +2 power (at most once per turn).";
      case "reflecting":
        return "Passive: When an enemy push displaces this, shove a random other lane one step.";
      case "costReduction":
        return effect.amount === 1
          ? "Passive: Your cards cost 1 less (minimum 0)."
          : `Passive: Your cards cost ${effect.amount} less (minimum 0).`;
      case "ancientDiscount":
        return "Passive: While in your hand, this costs 1 less at the end of each of your turns.";
      case "vaingloryGate":
        return "Passive: Playable only while The Eyes Privilege favors the enemy.";
      case "guardianLane":
        return "Passive: Your cards in this lane cannot be destroyed.";
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
      case "wildShift":
        return "Passive: At the end of your turn, move a random other card in this lane to another lane with space.";
      case "flowerBuff":
        return "Passive: At the end of your turn, give +1 power to a random friendly card.";
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
    case "dispersedSpread":
      return "Passive: When this is destroyed, spread its power randomly among your other cards on the board.";
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

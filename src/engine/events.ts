import { LANE_NAMES, type GameEvent, type Seat } from "./types";

/**
 * Turns an engine event into a sentence for the player at `viewer`'s seat, or null when it should not be shown
 * (the opponent's draws are hidden information).
 */
export function describeEvent(event: GameEvent, viewer: Seat): string | null {
  const who = (seat: Seat) => (seat === viewer ? "You" : "The enemy");
  const poss = (seat: Seat) => (seat === viewer ? "your" : "the enemy's");

  switch (event.type) {
    case "drew":
      return event.seat === viewer ? `You drew ${event.card.name}.` : null;
    case "burned":
      return null;
    case "turn_started":
      return null;
    case "played": {
      const lane = LANE_NAMES[event.lane];
      const base = `${who(event.seat)} played ${event.card.name} in the ${lane} lane.`;
      return event.destroyed
        ? `${base} ${event.destroyed.owner === event.seat ? "It pushed" : "It pushed off"} ${poss(event.destroyed.owner)} ${event.destroyed.card.name}, which is destroyed.`
        : base;
    }
    case "ability":
      return `${event.card.name} ${event.text}.`;
    case "moved": {
      const to = LANE_NAMES[event.to.lane];
      return `${who(event.seat)} ${event.card.name} slipped to the ${to} lane.`;
    }
    case "transformed":
      return `${event.from.name} became ${event.into.name}.`;
    case "tide_shifted": {
      if (event.rawDelta === 0) return "The Eye Privilege holds.";
      // The Eye Privilege is a BURDEN: it is pulled toward whoever had the weaker board this turn.
      // rawDelta > 0 means the bottom seat's board was stronger, so the burden pulls toward the TOP
      // (the enemy, from the bottom viewer's side); rawDelta < 0 pulls toward the bottom (you).
      const towardViewer =
        viewer === "bottom" ? event.rawDelta < 0 : event.rawDelta > 0;
      const mag = Math.abs(event.rawDelta);
      return towardViewer
        ? `The Eye Privilege pulls ${mag} toward you.`
        : `The Eye Privilege pulls ${mag} toward the enemy.`;
    }
    case "game_over":
      if (event.winner === "draw") return "The battle is a draw.";
      if (event.reason === "forfeit")
        return event.winner === viewer
          ? "The enemy forfeited."
          : "You forfeited.";
      return event.winner === viewer
        ? "You win the battle."
        : "You lose the battle.";
  }
}

export const describeEvents = (
  events: readonly GameEvent[],
  viewer: Seat,
): string[] =>
  events
    .map((e) => describeEvent(e, viewer))
    .filter((line): line is string => line !== null);

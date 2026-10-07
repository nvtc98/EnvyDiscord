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
    case "transformed":
      return `${event.from.name} became ${event.into.name}.`;
    case "tide_shifted": {
      if (event.delta === 0) return "The tide holds.";
      // A bottom-favouring shift (delta > 0) is "toward you" for the bottom viewer.
      const towardViewer =
        viewer === "bottom" ? event.delta > 0 : event.delta < 0;
      const mag = Math.abs(event.delta);
      return towardViewer
        ? `The tide shifts ${mag} toward you.`
        : `The tide shifts ${mag} toward the enemy.`;
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

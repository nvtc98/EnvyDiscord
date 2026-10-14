import type { BattleBeat } from "../discord/battle-session";
import type { Player } from "../game/player";

// The in-battle tutorial COPY + lesson selection. This module is pure: given a beat and the live
// player, it decides what (if anything) the bot should say and, as a side effect, flips the matching
// "already taught" flag on `player.story.tutorial` so each lesson is said exactly once. It does NO
// I/O — the launcher (src/discord/story-battle.ts) owns the DM send + re-anchor. Keeping the content
// here makes the teaching order unit-testable without any Discord mocks.
//
// Voice: single stranger, archaic-but-clear (per .kiro/steering/voice-and-tone.md). Narration leans
// old; the mechanic nouns the player must act on stay plain — lane, cost, power, energy.
// "The Eyes Privilege" is the in-game name of the balance meter (matches the battle log); it is a
// BURDEN dragged toward the weaker field each turn — drive it onto the enemy to win. Never "The Tide".

/** The fallback opponent name when the session has none; the npc file is the real source of truth. */
const OPPONENT_FALLBACK = "SPD";

/**
 * The reassurance line sent as a normal story DM just before the first cave board appears, so the
 * player sees "I will teach thee" BEFORE the board, then the board, then the lessons. Lives here so
 * all tutorial copy sits together.
 */
export const TUTORIAL_INTRO_LINE =
  "Fear not — I shall teach thee the game as we play. First, let us begin.";

/**
 * The tutorial lines to send for a beat, or null when the bot should stay silent this beat (already
 * taught, or a beat with no lesson). A non-null return has ALSO flipped the matching teach-once flag
 * on `player.story.tutorial` as a side effect, so the caller never has to know which flag a beat sets.
 * Each element is one DM bubble; the caller sends them in order, then re-anchors the board once.
 */
export function tutorialLineFor(
  ev: BattleBeat,
  player: Player,
): string[] | null {
  const t = player.story?.tutorial;
  if (!t) return null;
  const opponent = ev.session.opponentName ?? OPPONENT_FALLBACK;

  switch (ev.phase) {
    case "battle-start":
      if (t.goal) return null;
      t.goal = true;
      return [
        "Behold the board — three lanes, each three cells deep. Thy cards rise from thy side; his from his.",
        "Between you hangs The Eyes Privilege — a burden, not a boon. Each turn it is dragged toward whoever's field is the weaker. Keep thy side the stronger and drive it onto him; press it fully upon him, or leave it leaning his way when the duel ends, and thou hast won.",
        `${opponent} moves first, so he holds three cards; thou movest after, and holdest four. Watch, then answer.`,
      ];

    case "after-enemy-turn": {
      // Four taught-once lessons share this beat, in reading order and ALL before the player's first
      // move, so each lesson lands before it is needed (not after the fact):
      //   1) The Eyes Privilege shift (tideSeen)
      //   2) how to play a card — cost/power/lane/energy (play)   ← before the first move
      //   3) the push -> fall-off -> destroy rule (push)
      //   4) Active/Passive + SPD's Cấp 1 transform caution (ability), which builds on (3)
      // Each fires once; when all are taught, stay silent. The `play`/`push` flags are shared with the
      // (now silent) after-player-play / after-push beats, so neither lesson is ever re-taught.
      const bubbles: string[] = [];
      if (!t.tideSeen) {
        t.tideSeen = true;
        bubbles.push(
          "There — seest thou The Eyes Privilege shift? It moves only when a turn ends, dragged toward the weaker field. Now it has spoken.",
        );
      }
      if (!t.play) {
        t.play = true;
        bubbles.push(
          "Now it is thy move. A card bears its cost at the top-left, its power at the top-right.",
          "Choose a card, then a lane — left, middle, or right — to set it down. Thy energy marks what thou canst yet afford.",
        );
      }
      if (!t.push) {
        t.push = true;
        bubbles.push(
          "And mark how cards push. Set a card upon an occupied cell and it shoves the one there a step back; shove a card past the far edge, and it is destroyed. Thus dost thou strip power from the field.",
        );
      }
      if (!t.ability) {
        t.ability = true;
        bubbles.push(
          "Mark his first card. A card may bear an art: an *Active*, which wakes but once when it is played, or a *Passive*, ever at work while it holds the field.",
          "This one bears a Passive, and a cruel one. Now that thou knowest the push: let a single card fall in this duel, his or thine, and the beast stirs — it changes its shape, and grows stronger. So striking cards from the field is mighty — yet beware, for each one that falls feeds it. And should it climb to its final, fell shape — **Bò Siêu Phản Động Cấp 3** — pray thou dost not live to see such a horror. Tread with care.",
        );
      }
      return bubbles.length > 0 ? bubbles : null;
    }

    // The play (cost/power/lane/energy) and push lessons are both taught up front at after-enemy-turn,
    // BEFORE the player's first move — so these later beats stay silent (their flags are already set).
    case "after-player-play":
      if (t.play) return null;
      t.play = true;
      return [
        "Now it is thy move. A card bears its cost at the top-left, its power at the top-right.",
        "Choose a card, then a lane — left, middle, or right — to set it down. Thy energy marks what thou canst yet afford.",
      ];

    case "after-push":
      if (t.push) return null;
      t.push = true;
      return [
        "Mark that — a card set upon an occupied cell shoves the one there a step back. Shove it past the far edge and it is destroyed. Thus dost thou strip his power from the field.",
      ];

    case "after-player-end-turn":
      if (t.endTurn) return null;
      t.endTurn = true;
      return [`Now watch The Eyes Privilege move — then ${opponent} answers.`];

    // before-finish and every other (optional) beat: stay quiet. The END screen + chapter_end scene
    // carry the closing, so a tutorial one-liner here would only clash with them.
    default:
      return null;
  }
}

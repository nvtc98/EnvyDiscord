import type { Difficulty } from "../engine/ai";
import type { CardDef, GameState } from "../engine/types";
import type { Rng } from "../util/rng";

export interface NameAttempt {
  typed: string;
  result: "exact" | "near" | "none";
  suggestion?: string;
}

export interface StoryLine {
  /** Who speaks. A line without a speaker is narration. */
  speaker?: string;
  text: string;
  /** Extra pause (ms) shown as "typing" before this line, on top of the length-based delay. For dramatic beats. */
  pauseBeforeMs?: number;
}

/** Where the player is in the story, and what they have told it. Saved with the player. */
export interface StoryState {
  /** The scene the player is in. */
  node: string;
  /** The player's name as a member of The Eyes, e.g. "Ocean Eyes". Null until given, or if they are not one of The Eyes. */
  name: string | null;
  isEye: boolean | null;
  knowsTribe: boolean | null;
  /** Every name the player typed, in order, with how it matched. */
  nameAttempts: NameAttempt[];
  /** A name the player typed that was not recognised, waiting for them to decide what to do. */
  pendingName: { typed: string; suggestion: string | null } | null;
  /** A line shown once at the top of the next scene view (a reaction to the last action). */
  notice: StoryLine | null;
  /** The twelve cards currently shown in the book, and how many times the player has had them redrawn. */
  pack: { cards: string[]; rerolls: number } | null;
  /** True once the player has taken their first twelve cards. /daily unlocks after this. */
  starterClaimed: boolean;
  /**
   * The id of the DM message that currently carries this scene's live buttons. A button pressed on
   * any other message is stale and must not advance the story. Null in a server/ephemeral render or
   * before the first DM send.
   */
  liveMessageId: string | null;
  /** The land the player is being led to after taking the deck. Enables the active Bò Tuôi arrow on the second map view. */
  chapter: "bo-tuoi" | null;
  /** The live story-battle, when one is running (null otherwise). Persisted so leaving/resuming behaves sanely. */
  battle: StoryBattleState | null;
  /** Set once the cave duel has been won, so the chapter closes and does not restart. */
  caveWon: boolean;
  /**
   * Set when the story is parked at `victory_roster` waiting for the player to run /daily; cleared the
   * moment the story advances past the wait (the daily hook, or the already-claimed fallback button).
   * Optional + back-filled to false on load, like the other late-added flags.
   */
  awaitingDaily?: boolean;
  /**
   * In-battle tutorial "already taught" flags, each set the first time the matching lesson is
   * delivered so the bot never re-teaches it on a later beat. Only the first cave duel attaches the
   * tutorial, so these are only ever set then. Optional + back-filled to `{}` on load.
   */
  tutorial?: {
    goal?: boolean;
    play?: boolean;
    push?: boolean;
    endTurn?: boolean;
    tideSeen?: boolean;
    /** The turn-1 Active/Passive + push-destroy transform lesson, taught through SPD's Cấp 1 card. */
    ability?: boolean;
  };
}

/** A story-driven battle, serialisable, saved on the player so a resume can rebuild the board. */
export interface StoryBattleState {
  /** Which story battle this is (future chapters add more). */
  kind: "cave";
  /** The serialised engine GameState (already structuredClone-able plain data). */
  state: GameState;
  /** The card picked in the hand select, if any. */
  selectedUid: number | null;
  /** The viewer-worded battle log, capped. */
  log: string[];
  /** Difficulty, for reward wording / future tuning. */
  difficulty: Difficulty;
  /** Opponent portrait asset key for the renderer (e.g. "boss-spd-battle"). */
  opponentPortrait: string | null;
}

export interface StoryChoice {
  label: string;
  style?: "primary" | "secondary" | "success" | "danger";
  /** An emoji shown on the button, e.g. "⬅️". */
  emoji?: string;
}

export interface MapLocation {
  id: string;
  name: string;
  /** Position on the map image, 0 to 1 from the left and the top. */
  x: number;
  y: number;
  /** The player stands here. */
  here?: boolean;
}

export interface MapView {
  locations: MapLocation[];
  links: [string, string][];
}

/** What the player sees in one scene. The Discord layer turns it into a message. */
export interface StoryView {
  title: string;
  lines: StoryLine[];
  choices: StoryChoice[];
  /** The scene asks the player to type something (opens a form). */
  input?: {
    buttonLabel: string;
    modalTitle: string;
    label: string;
    placeholder: string;
  };
  map?: MapView;
  pack?: { cards: CardDef[] };
  /** A portrait image to show in a rich scene (e.g. the inside man). Asset key resolved by the Discord layer. */
  portrait?: { assetKey: string; alt: string };
  /** When set, this scene IS a running battle; the Discord layer renders the battle view, not story text. */
  battle?: { sessionId: string };
}

export type StoryAction =
  | { type: "choice"; index: number }
  | { type: "text"; text: string };

export interface StoryContext {
  rng: Rng;
  cards: readonly CardDef[];
  cardIndex: ReadonlyMap<string, CardDef>;
}

export type StoryEvent =
  | { type: "node"; node: string }
  | {
      type: "name_attempt";
      typed: string;
      result: NameAttempt["result"];
      suggestion?: string;
    }
  | {
      type: "name_set";
      name: string;
      how: "exact" | "suggestion" | "kept" | "free";
    }
  | { type: "pack_shown"; cards: string[]; rerolls: number }
  | { type: "pack_taken"; cards: string[]; rerolls: number };

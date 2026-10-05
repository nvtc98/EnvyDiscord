import { grantCard, type Player } from "../game/player";
import { STARTER_SIZE, drawStarterPack } from "../game/starter";
import { cleanStem, displayName, isStrangerStem, matchName } from "./names";
import type {
  StoryChoice,
  StoryContext,
  StoryEvent,
  StoryLine,
  StoryView,
} from "./types";

/**
 * One stranger speaks through the whole prologue. His name is never shown (the Discord layer
 * hides the speaker label), so this value only matters to tests that read `line.speaker`.
 * In fiction he calls himself "Stranger Eyes" — a self-given alias, not a real member of The Eyes.
 */
export const STRANGER = "Stranger";
export const TRIBE = "Bò Tuôi";
export const PLACE_WISDOM = "The Eyes Of Wisdom";

/**
 * The ready/resume gate shown BEFORE the real story scenes. It lives at the command layer (not in
 * NODES) so declining persists nothing — the engine never starts and `player.story` stays null.
 * Kept in the single stranger's direct second-person voice; no speaker label is shown.
 */
export const GATE = {
  /** No-progress greeting shown before the real `greeting` scene (both /story and /invite). */
  readyLine:
    "Hello there, stranger. Might I trouble you for a moment of your time?",
  readyYes: "Of course",
  readyNo: "Not right now",
  /** Shown after declining the ready-gate; nothing is saved. */
  declineLine:
    "No trouble at all. When you have a moment, just say /story and I'll be here.",
  /** /story resume (progress exists). */
  resumeLine: "There you are again. Shall we pick up where we left off?",
  resumeYes: "Yes, let's continue",
  resumeNo: "Not right now",
  /** /invite resume (progress exists); `inviter` is already a sanitized display name. */
  inviteResumeLine: (inviter: string): string =>
    `${inviter} reminded me about you. Shall we continue where we left off?`,
  /** Shown after declining a resume; saved progress is untouched. */
  resumeDeclineLine:
    "Of course. Whenever you're ready, say /story and we'll continue.",
} as const;

export interface NodeDef {
  view(player: Player, ctx: StoryContext): StoryView;
  /** A button was pressed. Updates the player and returns the id of the next scene (the same id stays here). */
  choose?(
    player: Player,
    index: number,
    ctx: StoryContext,
    events: StoryEvent[],
  ): string;
  /** The player submitted the form this scene asked for. */
  submit?(
    player: Player,
    text: string,
    ctx: StoryContext,
    events: StoryEvent[],
  ): string;
  /** Runs when the player arrives at this scene from another one. */
  onEnter?(player: Player, ctx: StoryContext, events: StoryEvent[]): void;
}

/** The stranger speaking to the player. */
const stranger = (text: string): StoryLine => ({ speaker: STRANGER, text });
/** A short stage-direction of the stranger's own gesture, in the moment. */
const narration = (text: string): StoryLine => ({ text });
const go = (
  label: string,
  style: StoryChoice["style"] = "primary",
): StoryChoice[] => [{ label, style }];

const story = (p: Player) => p.story!;
const who = (p: Player) => story(p).name ?? "traveler";

const ROAD = "The Road";
const CROSSROADS = "The Crossroads";

const REROLL_LINES: StoryLine[] = [
  stranger("Wrong way. I will close it, and you will try again."),
  stranger(
    "Hold it by the spine this time. There — the pages fall open somewhere else.",
  ),
  stranger("Close it. Breathe. Open it again. See? A different twelve."),
  stranger(
    "It is shy, this book. Give it a moment, and it shows you new pages.",
  ),
];

/** Shows twelve cards in the book. When the player asks again, the new twelve is never the same set. */
function showPack(
  player: Player,
  ctx: StoryContext,
  events: StoryEvent[],
  reroll: boolean,
): void {
  const s = story(player);
  const previous = new Set(s.pack?.cards ?? []);
  let ids: string[] = [];
  for (let attempt = 0; attempt < 10; attempt++) {
    ids = drawStarterPack(ctx.cards, ctx.rng).map((c) => c.id);
    if (previous.size === 0 || ids.some((id) => !previous.has(id))) break;
  }
  const rerolls = (s.pack?.rerolls ?? 0) + (reroll ? 1 : 0);
  s.pack = { cards: ids, rerolls };
  events.push({ type: "pack_shown", cards: ids, rerolls });
}

export const NODES: Record<string, NodeDef> = {
  greeting: {
    view: () => ({
      title: ROAD,
      lines: [
        stranger(
          "Hear that wind? It has been dragging dead leaves down this road since morning. Few people come this way now — but I have been waiting for one who would.",
        ),
        stranger("Tell me: are you one of The Eyes?"),
      ],
      choices: [
        { label: "Yes, I am one of The Eyes", style: "primary" },
        { label: "No, I am not", style: "secondary" },
      ],
    }),
    choose(p, index) {
      story(p).isEye = index === 0;
      return index === 0 ? "ask_name" : "not_eye";
    },
  },

  ask_name: {
    view: () => ({
      title: ROAD,
      lines: [
        stranger("I thought as much. There is a look about you I know."),
        stranger(
          "Every one of The Eyes carries a name that ends the same way. Tell me yours, and I will remember it.",
        ),
      ],
      choices: [],
      input: {
        buttonLabel: "Say my name",
        modalTitle: "Say your name",
        label: "Your name (Eyes is added for you)",
        placeholder: "Ocean",
      },
    }),
    submit(p, text, ctx, events) {
      const s = story(p);
      const stem = cleanStem(text);
      if (!stem) {
        s.notice = stranger("Say something. A name cannot be empty.");
        return "ask_name";
      }
      // "Stranger Eyes" is reserved — it belongs to someone else. Reject it hard; never keepable.
      if (isStrangerStem(stem)) {
        s.notice = stranger(
          "No. That name is already spoken for — it belongs to someone you have not met. Choose another.",
        );
        return "ask_name";
      }
      const typed = displayName(stem);
      const match = matchName(
        stem,
        ctx.cards.map((c) => c.name),
      );
      const attempt = {
        typed,
        result: match.kind,
        ...(match.kind === "near" ? { suggestion: match.suggestion } : {}),
      };
      s.nameAttempts.push(attempt);
      events.push({ type: "name_attempt", ...attempt });

      if (match.kind === "exact") {
        s.name = match.canonical;
        s.pendingName = null;
        events.push({ type: "name_set", name: s.name, how: "exact" });
        return "name_exact";
      }
      s.pendingName = {
        typed,
        suggestion: match.kind === "near" ? match.suggestion : null,
      };
      return "confirm_name";
    },
  },

  name_exact: {
    view: (p) => ({
      title: ROAD,
      lines: [
        stranger(
          `${story(p).name}. Yes... I know that name. It is written in the old records. I should have known you at once.`,
        ),
      ],
      choices: go("Continue"),
    }),
    choose: () => "tribe",
  },

  confirm_name: {
    view: (p) => {
      const pending = story(p).pendingName!;
      const lines = [
        stranger(
          `Hm. I find no “${pending.typed}” in the old records of The Eyes.`,
        ),
      ];
      lines.push(
        stranger(
          pending.suggestion
            ? `Could your name be ${pending.suggestion}?`
            : "Nor anything close to it.",
        ),
      );
      lines.push(stranger("Are you certain of your name?"));
      const choices: StoryChoice[] = [];
      if (pending.suggestion)
        choices.push({
          label: `Yes, I am ${pending.suggestion}`,
          style: "primary",
        });
      choices.push({ label: "I will say it again", style: "secondary" });
      choices.push({
        label: `Yes, I am ${pending.typed}`,
        style: pending.suggestion ? "secondary" : "primary",
      });
      return { title: ROAD, lines, choices };
    },
    choose(p, index, _ctx, events) {
      const s = story(p);
      const pending = s.pendingName!;
      const options: ("suggestion" | "again" | "kept")[] = pending.suggestion
        ? ["suggestion", "again", "kept"]
        : ["again", "kept"];
      const picked = options[index];
      if (picked === "again") {
        s.pendingName = null;
        s.notice = stranger("Say it again, then.");
        return "ask_name";
      }
      s.name = picked === "suggestion" ? pending.suggestion! : pending.typed;
      s.pendingName = null;
      events.push({ type: "name_set", name: s.name, how: picked });
      return "name_confirmed";
    },
  },

  name_confirmed: {
    view: (p) => ({
      title: ROAD,
      lines: [
        stranger(
          `Very well, ${story(p).name}. A name is only what its bearer makes of it.`,
        ),
      ],
      choices: go("Continue"),
    }),
    choose: () => "tribe",
  },

  not_eye: {
    view: () => ({
      title: ROAD,
      lines: [
        stranger(
          "No matter. The road is kind to anyone who keeps walking. Stay with me a while.",
        ),
      ],
      choices: go("Continue"),
    }),
    choose: () => "tribe",
  },

  tribe: {
    view: () => ({
      title: ROAD,
      lines: [
        stranger(
          `I am searching for a tribe: the ${TRIBE}. Do you know where they live?`,
        ),
      ],
      choices: [
        { label: "Yes, I know where they are", style: "primary" },
        { label: "No, I do not", style: "secondary" },
      ],
    }),
    choose(p, index) {
      const s = story(p);
      s.knowsTribe = index === 0;
      if (index === 0) return "tribe_known";
      return s.isEye ? "tribe_unknown_eye" : "tribe_unknown_stranger";
    },
  },

  tribe_known: {
    view: () => ({
      title: ROAD,
      lines: [
        stranger(
          "Then you are worth more to me than most travelers. Keep that knowledge close — I will need it before the end.",
        ),
      ],
      choices: go("Continue"),
    }),
    choose: () => "curse",
  },

  tribe_unknown_eye: {
    view: () => ({
      title: ROAD,
      lines: [
        stranger("Oh? But you are one of The Eyes. Surely you know the way."),
        stranger("Point me in the right direction. Even a guess will do."),
      ],
      choices: go("Point the way"),
    }),
    choose: () => "curse",
  },

  tribe_unknown_stranger: {
    view: () => ({
      title: ROAD,
      lines: [
        stranger(
          "Then we search together, you and I. Two pairs of eyes see further than one.",
        ),
      ],
      choices: go("Continue"),
    }),
    choose: () => "curse",
  },

  curse: {
    view: () => ({
      title: ROAD,
      lines: [
        narration("He pulls his hood lower against the colder wind."),
        stranger(
          `I must warn you, though. The ${TRIBE} — Bò Tuôi — carry a strange curse. No outsider can walk up to them in the ordinary way. The road bends, and the path forgets you.`,
        ),
        stranger(
          "But you have me. I can bring us in safely — I know the way through.",
        ),
        stranger(
          "My price is a duel: beat me at cards, and I will bring us in safely. To challenge me, though, you need a deck of The Eyes of your own.",
        ),
        stranger(
          `That deck lies in ${PLACE_WISDOM}, a place within the lands of The Eyes. Come there with me, and I will show you how to claim it.`,
        ),
      ],
      choices: go("Continue"),
    }),
    choose: () => "informant",
  },

  informant: {
    view: () => ({
      title: CROSSROADS,
      lines: [
        narration(
          "He steps off the road where it splits three ways, and waits for you to catch up.",
        ),
        stranger(
          `This is the crossroads. From here, take me to ${PLACE_WISDOM}, and I will show you what waits inside.`,
        ),
      ],
      choices: go("Look at the map"),
    }),
    choose: () => "map",
  },

  map: {
    view: () => ({
      title: CROSSROADS,
      lines: [stranger("So — where shall we go?")],
      choices: [
        { label: PLACE_WISDOM, style: "primary", emoji: "⬅️" },
        { label: TRIBE, style: "primary", emoji: "➡️" },
      ],
      map: {
        locations: [
          { id: "wisdom", name: PLACE_WISDOM, x: 0.16, y: 0.5 },
          { id: "crossroads", name: CROSSROADS, x: 0.5, y: 0.5, here: true },
          { id: "tribe", name: TRIBE, x: 0.84, y: 0.5 },
        ],
        links: [
          ["crossroads", "wisdom"],
          ["crossroads", "tribe"],
        ],
      },
    }),
    choose: (_p, index) => (index === 0 ? "wisdom" : "map_not_yet"),
  },

  map_not_yet: {
    view: () => ({
      title: CROSSROADS,
      lines: [
        stranger(
          `${TRIBE}? Not yet. Without the deck the gate stays shut — and so do I. The book first.`,
        ),
      ],
      choices: go("Back to the map", "secondary"),
    }),
    choose: () => "map",
  },

  wisdom: {
    view: () => ({
      title: PLACE_WISDOM,
      lines: [
        stranger(
          "Mind your step. Painted eyes cover every wall in here, and every one of them is watching you. Keep close to me.",
        ),
        stranger(
          "There, on the stand — there is a book. Open it the right way and it gives up the deck. I will tell you how.",
        ),
      ],
      choices: [
        { label: "How do you know all this?", style: "primary" },
        { label: "Just open the book", style: "secondary" },
      ],
    }),
    choose: (_p, index) => (index === 0 ? "wisdom_ask" : "book"),
  },

  wisdom_ask: {
    view: () => ({
      title: PLACE_WISDOM,
      lines: [
        stranger("How do I know the way, and who you are?"),
        narration(
          "A slow, knowing smile crosses his face, and he does not answer the rest.",
        ),
        stranger(
          "Let us say I keep an eye on things. For now, just call me Stranger Eyes. The book is waiting.",
        ),
      ],
      choices: go("Open the book"),
    }),
    choose: () => "book",
  },

  book: {
    view: (p, ctx) => {
      const s = story(p);
      const cards = (s.pack?.cards ?? [])
        .map((id) => ctx.cardIndex.get(id))
        .filter((c) => c !== undefined);
      const lines: StoryLine[] = [
        stranger(`Twelve pages, twelve cards. Do they suit you, ${who(p)}?`),
      ];
      return {
        title: PLACE_WISDOM,
        lines,
        choices: [
          { label: "Take these cards", style: "success" },
          { label: "Close the book and open it again", style: "secondary" },
        ],
        pack: { cards },
      };
    },
    onEnter: (p, ctx, events) => showPack(p, ctx, events, false),
    choose(p, index, ctx, events) {
      const s = story(p);
      if (index === 1) {
        s.notice = REROLL_LINES[s.pack!.rerolls % REROLL_LINES.length];
        showPack(p, ctx, events, true);
        return "book";
      }
      const ids = s.pack!.cards;
      for (const id of ids) grantCard(p, ctx.cardIndex.get(id)!);
      p.deck = [...ids];
      s.starterClaimed = true;
      events.push({ type: "pack_taken", cards: ids, rerolls: s.pack!.rerolls });
      return "book_taken";
    },
  },

  book_taken: {
    view: () => ({
      title: PLACE_WISDOM,
      lines: [
        narration(
          `The ${STARTER_SIZE} cards leave the pages and settle into your hands. The book closes on its own.`,
        ),
        stranger(
          "These will do. Remember what I asked of you, and I will remember what you took.",
        ),
      ],
      choices: go("Continue"),
    }),
    choose: () => "prologue_end",
  },

  prologue_end: {
    view: () => ({
      title: PLACE_WISDOM,
      lines: [
        stranger(
          `Come. The road to the ${TRIBE} is long, and the curse will not wait. We leave at dawn.`,
        ),
        narration("The story continues soon."),
      ],
      choices: [],
    }),
  },
};

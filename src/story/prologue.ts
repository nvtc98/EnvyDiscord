import { grantCard, type Player } from "../game/player";
import { STARTER_SIZE, drawStarterPack } from "../game/starter";
import {
  cleanFreeName,
  cleanStem,
  displayName,
  isStrangerStem,
  matchName,
} from "./names";
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
  readyLine: "Hark, stranger. Might I beg a moment of thy time?",
  readyYes: "Sure, what is it?",
  readyNo: "Not now",
  /** Shown after declining the ready-gate; nothing is saved. */
  declineLine:
    "No matter at all. When the hour suits thee, speak /story and here I shall wait.",
  /** /story resume (progress exists). */
  resumeLine:
    "There thou art again. Shall we take up the road where we left it?",
  resumeYes: "Yes, continue",
  resumeNo: "Not now",
  /** /invite resume (progress exists); `inviter` is already a sanitized display name. */
  inviteResumeLine: (inviter: string): string =>
    `${inviter} bade me remember thee. Shall we go on from where we left the road?`,
  /** Shown after declining a resume; saved progress is untouched. */
  resumeDeclineLine:
    "As thou wilt. Whenever thou art ready, speak /story and we shall go on.",
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
// NOTE: "traveler" is kept as the fallback form of address, in keeping with the archaic voice.

const ROAD = "The Road";
const CROSSROADS = "The Crossroads";

const REROLL_LINES: StoryLine[] = [
  stranger("Wrong way. I shall close it, and thou shalt try once more."),
  stranger(
    "Hold it by the spine this time. There — the pages fall open elsewhere.",
  ),
  stranger("Close it. Breathe. Open it anew. Seest thou? A different twelve."),
  stranger(
    "'Tis a shy book, this. Grant it a moment, and new pages it shows thee.",
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
          "Dost thou hear that wind? Since dawn it has dragged dead leaves down the old road. Few folk pass this way now — yet I have tarried here for one who would.",
        ),
        stranger("Tell me, then: are you one of The Eyes?"),
      ],
      choices: [
        { label: "Yes, I am one of The Eyes", style: "primary" },
        { label: "No, I am not", style: "secondary" },
      ],
    }),
    choose(p, index) {
      story(p).isEye = index === 0;
      return index === 0 ? "ask_name" : "ask_name_free";
    },
  },

  ask_name: {
    view: () => ({
      title: ROAD,
      lines: [
        stranger(
          "I thought as much. There is a look about thee I know of old.",
        ),
        stranger(
          "Every one of The Eyes bears a name that ends the same way. Speak thine to me, and I shall remember it.",
        ),
      ],
      choices: [],
      input: {
        buttonLabel: "Enter my name",
        modalTitle: "Enter your name",
        label: "Your name (Eyes is added for you)",
        placeholder: "Phantom",
      },
    }),
    submit(p, text, ctx, events) {
      const s = story(p);
      const stem = cleanStem(text);
      if (!stem) {
        s.notice = stranger("Speak something. A name cannot be empty.");
        return "ask_name";
      }
      // "Stranger Eyes" is reserved — it belongs to someone else. Reject it hard; never keepable.
      if (isStrangerStem(stem)) {
        s.notice = stranger(
          "Nay. That name is already spoken for — it belongs to one thou hast not yet met. Choose another.",
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
          `**${story(p).name}**. Yes... I know that name. 'Tis written in the old records. I should have known thee at once.`,
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
            ? `Could thy name be ${pending.suggestion}?`
            : "Nor aught close to it.",
        ),
      );
      lines.push(stranger("Art thou certain of thy name?"));
      const choices: StoryChoice[] = [];
      if (pending.suggestion)
        choices.push({
          label: `Yes, I am ${pending.suggestion}`,
          style: "primary",
        });
      choices.push({ label: "Say it again", style: "secondary" });
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
        s.notice = stranger("Speak it again, then.");
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
          `Very well, **${story(p).name}**. A name is but what its bearer makes of it.`,
        ),
      ],
      choices: go("Continue"),
    }),
    choose: () => "tribe",
  },

  ask_name_free: {
    view: () => ({
      title: ROAD,
      lines: [
        stranger(
          "No matter. The old road is kind to any who keep walking. Tarry with me a while.",
        ),
        stranger(
          "Still, I would know by what name to call thee. Speak it as thou wilt — thine own, whatever it be.",
        ),
      ],
      choices: [],
      input: {
        buttonLabel: "Enter my name",
        modalTitle: "Enter your name",
        label: "Your name",
        placeholder: "Phantom",
      },
    }),
    submit(p, text, _ctx, events) {
      const s = story(p);
      const name = cleanFreeName(text);
      if (!name) {
        s.notice = stranger("Speak something. A name cannot be empty.");
        return "ask_name_free";
      }
      s.name = name;
      s.pendingName = null;
      events.push({ type: "name_set", name, how: "free" });
      return "name_free_ack";
    },
  },

  name_free_ack: {
    view: (p) => ({
      title: ROAD,
      lines: [
        stranger(
          `**${who(p)}**. A fine name, and one I have not met upon this road. 'Tis thine alone, and that is no small thing.`,
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
          `I am in search of a tribe: the ${TRIBE}. Do you know where they live?`,
        ),
      ],
      choices: [
        { label: "Yes, I know where they are", style: "primary" },
        { label: "No, I don't", style: "secondary" },
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
          "Then thou art worth more to me than most who wander. Keep that knowledge close — I shall have need of it before the end.",
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
        stranger(
          "Oh? But you are one of The Eyes. Surely thou knowest the way.",
        ),
        stranger("Point me the right road. Even a guess shall serve."),
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
          "Then we search together, thou and I. Two pairs of eyes see further than one.",
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
        narration("Draw my hood lower against the colder wind."),
        stranger(
          `Yet I must warn thee. The ${TRIBE} — Bò Tuôi — bear a strange curse. No outsider may walk up to them in the common way. The road bends, and the path forgets thee.`,
        ),
        stranger(
          "But there is one who can lead us in — a man on the inside, who knows the ways beneath. He owes me a reckoning of old.",
        ),
        stranger(
          "His price is a duel. We must best him at cards, thou and I together — and only then will he open the road. Yet to sit at that table thou must bear a deck of The Eyes of thine own.",
        ),
        stranger(
          `That deck lies in ${PLACE_WISDOM}, a place within the lands of The Eyes. Come thither with me, and I shall show thee how to claim it.`,
        ),
      ],
      choices: [
        { label: "Continue", style: "primary" },
        { label: "Together?", style: "secondary" },
      ],
    }),
    choose(p, index) {
      // "Together?" — the player checks they are coming along; the stranger affirms it, and the
      // curse view (including the deck line) is re-shown with the affirmation on top. Loops.
      if (index === 1) {
        story(p).notice = stranger(
          "Aye — thou and I, together. I'll not walk into that place alone, nor leave thee behind.",
        );
        return "curse";
      }
      return "map";
    },
  },

  map: {
    view: () => ({
      title: CROSSROADS,
      lines: [
        stranger(
          `Here the road splits three ways. Take me to ${PLACE_WISDOM}, and I shall show thee what waits within. So — whither shall we go?`,
        ),
      ],
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
          `${TRIBE}? Not yet. Without the deck the gate stays shut — and so do I. The book comes first.`,
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
          "Mind thy step. Painted eyes cover every wall in here, and every one of them watches thee. Keep close to me.",
        ),
        stranger(
          "There, upon the stand — there is a book. Open it aright and it yields up the deck. I shall tell thee how.",
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
        stranger("How do I know the way, and who thou art?"),
        {
          speaker: STRANGER,
          // A long pause before this line, so he seems to muse before answering.
          pauseBeforeMs: 2500,
          text: "Let us say I keep an eye on things. For now, do but call me Stranger Eyes. The book is waiting.",
        },
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
        stranger(
          `Twelve pages, twelve cards. Do they suit thee, **${who(p)}**?`,
        ),
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
          `The ${STARTER_SIZE} cards leave the pages and settle into your hands. The book closes of its own accord.`,
        ),
        stranger(
          "These shall serve. Remember what I asked of thee, and I shall remember what thou tookest.",
        ),
      ],
      choices: go("Continue"),
    }),
    choose: () => "deck_praise",
  },

  // ---- The first chapter: the cave duel ----

  deck_praise: {
    view: (p) => ({
      title: PLACE_WISDOM,
      lines: [
        stranger(
          `These twelve... a fortunate draw, **${who(p)}**. The book was kind to thee — I have seen it yield far meaner hands. Guard them well.`,
        ),
        narration("Turn the last page shut with a touch, and it seals itself."),
      ],
      choices: go("Continue"),
    }),
    choose: () => "to_bo_tuoi",
  },

  to_bo_tuoi: {
    view: () => ({
      title: CROSSROADS,
      lines: [
        stranger(
          `Come. I shall lead thee to the land of the ${TRIBE}. The curse will not wait, and neither shall I.`,
        ),
      ],
      choices: [
        { label: PLACE_WISDOM, style: "secondary", emoji: "⬅️" },
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
    onEnter: (p) => {
      story(p).chapter = "bo-tuoi";
    },
    choose: (_p, index) => (index === 0 ? "wisdom_locked" : "sea_cliff"),
  },

  wisdom_locked: {
    view: () => ({
      title: PLACE_WISDOM,
      lines: [
        stranger(
          `Back to ${PLACE_WISDOM}? There is naught left for us there — the book has given what it will. Our road runs on to the ${TRIBE}.`,
        ),
      ],
      choices: go("Back to the map", "secondary"),
    }),
    choose: () => "to_bo_tuoi",
  },

  sea_cliff: {
    view: () => ({
      title: TRIBE,
      lines: [
        narration(
          "Lead thee down where the old road gives way to bare stone, until the land ends at a cliff and the sea roars grey below.",
        ),
        stranger(
          "There — seest thou that dark seam in the rock? A cave mouth, half-drowned at the tide's turning. That is our way in.",
        ),
      ],
      choices: go("Continue"),
    }),
    choose: () => "curse_underground",
  },

  curse_underground: {
    view: () => ({
      title: TRIBE,
      lines: [
        stranger(
          `Hark, for this is the whole of it. The curse of the ${TRIBE} falls upon any who set foot upon their land — any who come to them over the ground above.`,
        ),
        stranger(
          "But we shall not set foot upon it. We go beneath — up through the dark, from the roots of the earth. The curse looks ever downward from the sky, and will not find us rising.",
        ),
      ],
      choices: go("Enter the cave"),
    }),
    choose: () => "cave_mouth",
  },

  cave_mouth: {
    view: () => ({
      title: TRIBE,
      lines: [
        stranger(
          "Ah. There thou art, old friend — I had half feared the dark had swallowed thee.",
        ),
        stranger(
          "Thou askest whether I have brought the deck? Aye. This one at my side has carried it the whole long road.",
        ),
        stranger(
          "But look at thy face... thinner than when last we met, and paler by half. The deep hath been feeding on thee, hath it not?",
        ),
      ],
      choices: go("Continue"),
    }),
    choose: () => "reveal_face",
  },

  reveal_face: {
    view: () => ({
      title: TRIBE,
      lines: [
        stranger(
          "Step into the light, that my companion may know the face across the table.",
        ),
        narration("The torch gutters, and his face swims up out of the black."),
        stranger(
          "This is **Bò SPD** — kin to the tribe above, and the one who keeps the gate below. Best him at the cards, and the road is thine.",
        ),
      ],
      choices: go("I am ready"),
      portrait: { assetKey: "boss-spd-story", alt: "Bò SPD" },
    }),
    choose: () => "cave_terms",
  },

  cave_terms: {
    view: () => ({
      title: TRIBE,
      lines: [
        stranger(
          "His terms are these, and I will not soften them: play him at the cards, and should thou lose, the deck is his — and the curse he will let fall upon thee, here where thou standest.",
        ),
        stranger("Win, and the road opens. That is the whole of the wager."),
      ],
      choices: [
        { label: "Accept", style: "success" },
        { label: "Refuse", style: "danger" },
      ],
    }),
    choose: (_p, index) => (index === 0 ? "cave_battle" : "cave_refuse"),
  },

  cave_refuse: {
    view: () => ({
      title: TRIBE,
      lines: [
        stranger(
          "Refuse? Here, in the deep, with the sea at thy back and the dark before thee — thou thinkest thou mayst refuse?",
        ),
        narration("Do not raise my voice. Do not need to."),
      ],
      choices: [
        { label: "...I accept", style: "success" },
        { label: "...I accept", style: "secondary" },
      ],
    }),
    choose: () => "cave_battle",
  },

  cave_battle: {
    // A valid StoryView: no lines, no choices, flagged as a battle so the Discord layer takes the
    // battle branch and never renders it as text. `sessionId` is a marker only ("" when no live
    // session yet); the real session is keyed by userId. onEnter is a pure no-op — the launch is
    // Discord I/O driven by deliverScene detecting view.battle.
    view: () => ({
      title: TRIBE,
      lines: [],
      choices: [],
      battle: { sessionId: "" },
    }),
  },

  cave_loss: {
    view: () => ({
      title: TRIBE,
      lines: [
        stranger(
          "The deck slips from thy grasp... but hold. The dark here runs strange, and time with it. I can turn us back to the moment before the first card fell. Try once more.",
        ),
      ],
      choices: go("Try again", "primary"),
    }),
    // Discard the lost snapshot so the launcher takes the FRESH path on retry.
    choose: (p) => {
      story(p).battle = null;
      return "cave_battle";
    },
  },

  chapter_end: {
    view: () => ({
      title: TRIBE,
      lines: [
        stranger(
          "It is done. The road opens before us, and the man steps aside into the dark. We are through — and the tale continues anon.",
        ),
        narration(
          "The torchlight steadies. Whatever comes next, it waits beyond this page.",
        ),
      ],
      choices: [],
    }),
  },
};

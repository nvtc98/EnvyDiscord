import { describe, expect, it } from "vitest";
import {
  CARDS,
  CARD_INDEX,
  COLLECTIBLE_CARDS,
  COLLECTIBLE_CARD_INDEX,
} from "../src/data/cards";
import type { CardDef } from "../src/engine/types";
import { STARTER_SIZE, drawStarterPack } from "../src/game/starter";
import { createPlayer, type Player } from "../src/game/player";
import {
  applyAction,
  currentView,
  ensureStory,
  resolveStoryBattle,
} from "../src/story/engine";
import { cleanStem, displayName, matchName } from "../src/story/names";
import { NODES, PLACE_WISDOM, STRANGER, TRIBE } from "../src/story/prologue";
import type { StoryContext } from "../src/story/types";
import { mulberry32 } from "../src/util/rng";

// The story only ever shows/grants collectible cards, so the test context mirrors production
// (storyContext wires the Eyes-only pool). Name matching runs against the collectible names.
const NAMES = COLLECTIBLE_CARDS.map((c) => c.name);
const ctx = (seed = 1): StoryContext => ({
  rng: mulberry32(seed),
  cards: COLLECTIBLE_CARDS,
  cardIndex: COLLECTIBLE_CARD_INDEX,
});

describe("names", () => {
  it('cleanStem drops a typed "Eyes", extra spaces and control characters, and caps the length', () => {
    expect(cleanStem("  Ocean   Eyes ")).toBe("Ocean");
    expect(cleanStem("ocean eyes")).toBe("ocean");
    expect(cleanStem("Ocean\u0000\n")).toBe("Ocean");
    expect(cleanStem("**Ocean** <@123456> `x` [a](http://b)")).toBe(
      "Ocean 123456 x ahttpb",
    );
    expect(cleanStem("O'Brien-Smith Jr.")).toBe("O'Brien-Smith Jr.");
    expect(cleanStem("Đại Dương")).toBe("Đại Dương");
    expect(cleanStem("Eyes")).toBe("");
    expect(cleanStem("   ")).toBe("");
    expect(cleanStem("x".repeat(80))).toHaveLength(30);
    expect(cleanStem("Keyes")).toBe("Keyes"); // only a separate word "Eyes" is dropped
  });

  it("displayName capitalises words and hyphenated parts and appends Eyes", () => {
    expect(displayName("ocean")).toBe("Ocean Eyes");
    expect(displayName("ocean blue")).toBe("Ocean Blue Eyes");
    expect(displayName("x-ray")).toBe("X-Ray Eyes");
    expect(displayName("alterra's")).toBe("Alterra's Eyes");
    expect(displayName("ÉLAN")).toBe("Élan Eyes");
  });

  it("matches a real name exactly, ignoring case, spaces, hyphens and apostrophes, and returns the list spelling", () => {
    expect(matchName("abyss", NAMES)).toEqual({
      kind: "exact",
      canonical: "Abyss Eyes",
    });
    expect(matchName("ABYSS", NAMES)).toEqual({
      kind: "exact",
      canonical: "Abyss Eyes",
    });
    expect(matchName("x ray", NAMES)).toEqual({
      kind: "exact",
      canonical: "X-Ray Eyes",
    });
    expect(matchName("alterras", NAMES)).toEqual({
      kind: "exact",
      canonical: "Alterra's Eyes",
    });
  });

  it("suggests the nearest name for a slip, and nothing for something unrelated", () => {
    expect(matchName("abiss", NAMES)).toEqual({
      kind: "near",
      suggestion: "Abyss Eyes",
    });
    expect(matchName("crystl", NAMES)).toEqual({
      kind: "near",
      suggestion: "Crystal Eyes",
    });
    expect(matchName("qqqqqqqq", NAMES).kind).toBe("none");
    expect(matchName("", NAMES).kind).toBe("none");
    expect(matchName("???", NAMES).kind).toBe("none");
  });

  it("is strict about very short names: one slip at most", () => {
    const names = ["Ox Eyes", "Zen Eyes"];
    expect(matchName("ax", names)).toEqual({
      kind: "near",
      suggestion: "Ox Eyes",
    });
    expect(matchName("qq", names).kind).toBe("none");
  });

  it("breaks ties between equally close names alphabetically, so the suggestion is stable", () => {
    expect(matchName("bat", ["Cat Eyes", "Hat Eyes", "Mat Eyes"])).toEqual({
      kind: "near",
      suggestion: "Cat Eyes",
    });
  });
});

describe("starter pack", () => {
  const rarityCounts = (pack: CardDef[]) => ({
    eternal: pack.filter((c) => c.rarity === "eternal").length,
    bargain: pack.filter((c) => c.rarity === "bargain").length,
    common: pack.filter((c) => c.rarity === "common").length,
  });

  it("is always 12 different cards: 2 eternal, 2 bargain and 8 common", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const pack = drawStarterPack(COLLECTIBLE_CARDS, mulberry32(seed));
      expect(pack).toHaveLength(STARTER_SIZE);
      expect(new Set(pack.map((c) => c.id)).size).toBe(12);
      expect(rarityCounts(pack)).toEqual({ eternal: 2, bargain: 2, common: 8 });
    }
  });

  it("differs between draws", () => {
    const rng = mulberry32(5);
    const a = drawStarterPack(COLLECTIBLE_CARDS, rng)
      .map((c) => c.id)
      .sort()
      .join();
    const b = drawStarterPack(COLLECTIBLE_CARDS, rng)
      .map((c) => c.id)
      .sort()
      .join();
    expect(a).not.toBe(b);
  });

  it("fails loudly when the card list cannot supply the mix", () => {
    expect(() =>
      drawStarterPack(
        COLLECTIBLE_CARDS.filter((c) => c.rarity !== "eternal"),
        mulberry32(1),
      ),
    ).toThrow(/eternal/);
  });

  it("every player (The Eyes) card has a rarity, a cost and a power", () => {
    // Opponent factions (e.g. botuoi) are intentionally rarity-less and never enter the starter
    // pack or collection, so this player-deck invariant is scoped to the collectible (Eyes) pool.
    for (const c of COLLECTIBLE_CARDS) {
      expect(["common", "bargain", "eternal"]).toContain(c.rarity);
      expect(c.cost).toBeGreaterThanOrEqual(1);
      // Stella Eyes is intentionally a 0-power body (power equals the destroyed-power tally when played).
      expect(c.power).toBeGreaterThanOrEqual(0);
    }
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
  });
});

/** Plays a scripted conversation: each step is a choice index, or a string to submit as text. */
function play(
  steps: (number | string)[],
  seed = 1,
  player: Player = createPlayer("p"),
): { player: Player; events: ReturnType<typeof applyAction>[] } {
  const c = ctx(seed);
  ensureStory(player, c);
  const results = [];
  for (const step of steps) {
    const node = player.story!.node;
    results.push(
      applyAction(
        player,
        node,
        typeof step === "number"
          ? { type: "choice", index: step }
          : { type: "text", text: step },
        c,
      ),
    );
  }
  return { player, events: results };
}

describe("story: the prologue", () => {
  it("starts at the greeting for a new player, and resuming shows the same scene", () => {
    const player = createPlayer("p");
    const events = ensureStory(player, ctx());
    expect(events).toEqual([{ type: "node", node: "greeting" }]);
    expect(ensureStory(player, ctx())).toEqual([]); // already started
    const view = currentView(player, ctx());
    expect(view.lines.map((l) => l.text).join(" ")).toMatch(
      /are you one of The Eyes/,
    );
    expect(view.choices).toHaveLength(2);
  });

  it("walks the whole prologue and into the first chapter, as an Eye who knows the way, up to the cave duel", () => {
    // yes (an Eye), a name from the list, continue, knows the tribe, continue through curse -> map,
    // wisdom (open the book), book (take), book_taken (continue) -> deck_praise -> to_bo_tuoi (Bò Tuôi ➡️)
    // -> sea_cliff -> curse_underground -> cave_mouth -> reveal_face -> cave_terms (accept) -> cave_battle.
    const { player, events } = play([
      0,
      "abyss",
      0,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      0,
    ]);
    expect(events.every((e) => e.ok)).toBe(true);
    expect(player.story).toMatchObject({
      node: "cave_battle",
      isEye: true,
      name: "Abyss Eyes",
      knowsTribe: true,
      starterClaimed: true,
      chapter: "bo-tuoi",
    });
    expect(Object.keys(player.cards)).toHaveLength(12);
    expect(player.deck).toHaveLength(12);
  });

  it("records every name the player typed, in order, and the final name", () => {
    const c = ctx();
    const player = createPlayer("p");
    ensureStory(player, c);
    applyAction(player, "greeting", { type: "choice", index: 0 }, c);
    applyAction(player, "ask_name", { type: "text", text: "qqqqqqqq" }, c); // nothing close
    expect(player.story!.node).toBe("confirm_name");
    expect(player.story!.pendingName).toEqual({
      typed: "Qqqqqqqq Eyes",
      suggestion: null,
    });
    applyAction(player, "confirm_name", { type: "choice", index: 0 }, c); // I will say it again
    expect(player.story!.node).toBe("ask_name");
    expect(currentView(player, c).lines[0].text).toBe("Speak it again, then.");
    applyAction(player, "ask_name", { type: "text", text: "abiss" }, c); // near Abyss
    expect(player.story!.pendingName).toEqual({
      typed: "Abiss Eyes",
      suggestion: "Abyss Eyes",
    });
    expect(currentView(player, c).choices.map((x) => x.label)).toEqual([
      "Yes, I am Abyss Eyes",
      "Say it again",
      "Yes, I am Abiss Eyes",
    ]);
    applyAction(player, "confirm_name", { type: "choice", index: 2 }, c); // keep what I typed
    expect(player.story!.name).toBe("Abiss Eyes");
    expect(player.story!.node).toBe("name_confirmed");
    expect(player.story!.nameAttempts).toEqual([
      { typed: "Qqqqqqqq Eyes", result: "none" },
      { typed: "Abiss Eyes", result: "near", suggestion: "Abyss Eyes" },
    ]);
  });

  it("accepting the suggestion uses the list spelling", () => {
    const c = ctx();
    const player = createPlayer("p");
    ensureStory(player, c);
    applyAction(player, "greeting", { type: "choice", index: 0 }, c);
    applyAction(player, "ask_name", { type: "text", text: "abiss" }, c);
    const result = applyAction(
      player,
      "confirm_name",
      { type: "choice", index: 0 },
      c,
    );
    expect(player.story!.name).toBe("Abyss Eyes");
    expect(result).toMatchObject({
      ok: true,
      events: expect.arrayContaining([
        { type: "name_set", name: "Abyss Eyes", how: "suggestion" },
      ]),
    });
  });

  it("an exact name skips the confirmation and is welcomed", () => {
    const c = ctx();
    const player = createPlayer("p");
    ensureStory(player, c);
    applyAction(player, "greeting", { type: "choice", index: 0 }, c);
    applyAction(player, "ask_name", { type: "text", text: "abyss eyes" }, c); // typing "Eyes" as well is fine
    expect(player.story).toMatchObject({
      node: "name_exact",
      name: "Abyss Eyes",
      nameAttempts: [{ typed: "Abyss Eyes", result: "exact" }],
    });
    expect(currentView(player, c).lines[0].text).toContain("Abyss Eyes");
  });

  it("an empty name is refused politely and the player stays on the same question", () => {
    const c = ctx();
    const player = createPlayer("p");
    ensureStory(player, c);
    applyAction(player, "greeting", { type: "choice", index: 0 }, c);
    applyAction(player, "ask_name", { type: "text", text: "  Eyes " }, c);
    expect(player.story!.node).toBe("ask_name");
    expect(player.story!.nameAttempts).toEqual([]);
    expect(currentView(player, c).lines[0].text).toMatch(/cannot be empty/);
  });

  it('hard-rejects the reserved name "Stranger" and never lets it be kept, then accepts a normal name', () => {
    for (const typed of [
      "Stranger",
      "  stranger  ",
      "stranger eyes",
      "Stranger Eyes",
    ]) {
      const c = ctx();
      const player = createPlayer("p");
      ensureStory(player, c);
      applyAction(player, "greeting", { type: "choice", index: 0 }, c);
      applyAction(player, "ask_name", { type: "text", text: typed }, c);
      // stays on ask_name, nothing recorded, no pending name to "keep" — not keepable
      expect(player.story!.node, typed).toBe("ask_name");
      expect(player.story!.nameAttempts, typed).toEqual([]);
      expect(player.story!.pendingName, typed).toBeNull();
      expect(currentView(player, c).lines[0].text, typed).toMatch(
        /already spoken for/,
      );
      // a normal name right after a rejected attempt still works
      applyAction(player, "ask_name", { type: "text", text: "abyss" }, c);
      expect(player.story!.node, typed).toBe("name_exact");
      expect(player.story!.name, typed).toBe("Abyss Eyes");
      expect(player.story!.nameAttempts, typed).toEqual([
        { typed: "Abyss Eyes", result: "exact" },
      ]);
    }
  });

  it('accepts "Phantom" in the Eyes branch (not blocked) and normalizes it to "Phantom Eyes"', () => {
    for (const typed of ["Phantom", "phantom", "Phantom Eyes"]) {
      const c = ctx();
      const player = createPlayer("p");
      ensureStory(player, c);
      applyAction(player, "greeting", { type: "choice", index: 0 }, c);
      applyAction(player, "ask_name", { type: "text", text: typed }, c);
      expect(player.story!.name, typed).toBe("Phantom Eyes");
      expect(player.story!.node, typed).toBe("name_exact");
    }
  });

  it("the non-Eyes reaction differs from the Eyes-branch recognition line", () => {
    const free = play([1, "nomad"]); // non-Eyes free name
    const eyes = play([0, "abyss"]); // Eyes exact name
    const freeLine = currentView(free.player, ctx()).lines[0].text;
    const eyesLine = currentView(eyes.player, ctx()).lines[0].text;
    expect(free.player.story!.node).toBe("name_free_ack");
    expect(eyes.player.story!.node).toBe("name_exact");
    expect(freeLine).not.toBe(eyesLine);
    expect(freeLine).not.toMatch(/old records/);
    expect(eyesLine).toMatch(/old records/);
  });

  it("saying no to The Eyes still asks a name, but in a free form that is not matched or given Eyes", () => {
    const { player } = play([1, "abyss"]); // "abyss" would match a card if this path matched — it must not
    expect(player.story).toMatchObject({
      isEye: false,
      name: "Abyss", // no "Eyes" appended, no card-list match
      node: "name_free_ack",
      nameAttempts: [], // the free path records no match attempts
    });
    // the free reaction differs from the Eyes branch's recognition line
    const reaction = currentView(player, ctx()).lines[0].text;
    expect(reaction).not.toMatch(/old records/);
    expect(reaction).toMatch(/Abyss/);
  });

  it("the free name is sanitized but keeps a trailing Eyes and never matches the card list", () => {
    const { player } = play([1, "**Ocean** <@123> Eyes"]);
    expect(player.story).toMatchObject({
      isEye: false,
      name: "Ocean 123 Eyes", // sanitized, capitalized, no 'Eyes' stripped, no match
      node: "name_free_ack",
    });
  });

  it("asks about the tribe, and reacts differently to an Eye, a stranger and someone who knows", () => {
    const asEye = play([1 - 1, "abyss", 0, 1]); // eye, exact name, continue, "no"
    expect(asEye.player.story!.node).toBe("tribe_unknown_eye");
    expect(
      currentView(asEye.player, ctx())
        .lines.map((l) => l.text)
        .join(" "),
    ).toMatch(/you are one of The Eyes/);

    const stranger = play([1, "nomad", 0, 1]); // not an eye, name, continue, "no"
    expect(stranger.player.story!.node).toBe("tribe_unknown_stranger");
    expect(currentView(stranger.player, ctx()).lines[0].text).toMatch(
      /search together/,
    );

    const knows = play([1, "nomad", 0, 0]);
    expect(knows.player.story!.node).toBe("tribe_known");
    expect(knows.player.story!.knowsTribe).toBe(true);
  });

  it("every path reaches the curse, and the tribe name is spelled with its Vietnamese letters", () => {
    for (const steps of [
      [1, "nomad", 0, 1, 0],
      [1, "nomad", 0, 0, 0],
    ]) {
      const { player } = play(steps);
      expect(player.story!.node).toBe("curse");
      const text = currentView(player, ctx())
        .lines.map((l) => l.text)
        .join(" ");
      expect(text).toContain(TRIBE);
      expect(text).toContain("Bò Tuôi");
      expect(text).toContain(PLACE_WISDOM);
    }
  });

  it("the map offers at most four places, shows three locations and refuses to go to the tribe yet", () => {
    const { player } = play([1, "nomad", 0, 1, 0, 0]); // ... curse -> map
    expect(player.story!.node).toBe("map");
    const view = currentView(player, ctx());
    expect(view.choices.length).toBeLessThanOrEqual(4);
    expect(view.map!.locations.map((l) => l.name)).toEqual([
      PLACE_WISDOM,
      "The Crossroads",
      "Bò Tuôi",
    ]);
    expect(view.map!.locations.find((l) => l.here)!.name).toBe(
      "The Crossroads",
    );
    const left = view.map!.locations.find((l) => l.name === PLACE_WISDOM)!;
    const right = view.map!.locations.find((l) => l.name === "Bò Tuôi")!;
    expect(left.x).toBeLessThan(0.5);
    expect(right.x).toBeGreaterThan(0.5);

    applyAction(player, "map", { type: "choice", index: 1 }, ctx()); // Bò Tuôi
    expect(player.story!.node).toBe("map_not_yet");
    expect(currentView(player, ctx()).lines[0].text).toMatch(/Not yet/);
    applyAction(player, "map_not_yet", { type: "choice", index: 0 }, ctx());
    expect(player.story!.node).toBe("map");
    applyAction(player, "map", { type: "choice", index: 0 }, ctx()); // Wisdom
    expect(player.story!.node).toBe("wisdom");
  });

  describe("the book", () => {
    // not an Eye ... curse -> map -> wisdom; "Just open the book" (index 1) -> book
    const toBook = (seed = 1) => play([1, "nomad", 0, 1, 0, 0, 0, 1], seed);
    const idsOf = (p: Player) => p.story!.pack!.cards;

    it("opens with twelve different cards in the 2-2-8 mix, and nothing is granted until the player takes them", () => {
      const { player } = toBook();
      expect(player.story!.node).toBe("book");
      expect(idsOf(player)).toHaveLength(12);
      expect(new Set(idsOf(player)).size).toBe(12);
      expect(player.cards).toEqual({});
      expect(player.story!.starterClaimed).toBe(false);
      const view = currentView(player, ctx());
      expect(view.pack!.cards).toHaveLength(12);
      expect(view.choices.map((c) => c.label)).toEqual([
        "Take these cards",
        "Close the book and open it again",
      ]);
    });

    it("closing and reopening shows a different twelve with the same mix, counts the tries, and the stranger reacts", () => {
      const c = ctx(2);
      const { player } = toBook(2);
      const first = [...idsOf(player)];
      const seen = new Set<string>();
      let previous = first.join();
      for (let i = 1; i <= 6; i++) {
        const result = applyAction(
          player,
          "book",
          { type: "choice", index: 1 },
          c,
        );
        expect(result.ok).toBe(true);
        expect(player.story!.node).toBe("book");
        expect(player.story!.pack!.rerolls).toBe(i);
        expect(idsOf(player).join()).not.toBe(previous);
        previous = idsOf(player).join();
        const pack = idsOf(player).map((id) => CARD_INDEX.get(id)!);
        expect(pack.filter((x) => x.rarity === "eternal")).toHaveLength(2);
        expect(pack.filter((x) => x.rarity === "bargain")).toHaveLength(2);
        expect(pack.filter((x) => x.rarity === "common")).toHaveLength(8);
        const first = currentView(player, c).lines[0];
        expect(first.speaker).toBe(STRANGER);
        seen.add(first.text);
        expect(player.cards).toEqual({}); // still nothing granted
      }
      expect(seen.size).toBeGreaterThan(1); // the reactions vary
      expect(first.join()).not.toBe(idsOf(player).join());
    });

    it("taking the cards grants exactly those twelve as metal, makes them the deck and unlocks /daily", () => {
      const c = ctx();
      const { player } = toBook();
      const shown = [...idsOf(player)];
      const result = applyAction(
        player,
        "book",
        { type: "choice", index: 0 },
        c,
      );
      expect(result).toMatchObject({ ok: true });
      expect(Object.keys(player.cards).sort()).toEqual([...shown].sort());
      expect(
        Object.values(player.cards).every(
          (c) =>
            c.active === "metal" &&
            c.variants.length === 1 &&
            c.variants[0] === "metal",
        ),
      ).toBe(true);
      expect(player.deck).toEqual(shown);
      expect(player.story).toMatchObject({
        starterClaimed: true,
        node: "book_taken",
      });
      applyAction(player, "book_taken", { type: "choice", index: 0 }, c);
      expect(player.story!.node).toBe("deck_praise");
      expect(currentView(player, c).choices).toHaveLength(1);
    });

    it("rerolling many times and then taking still gives a valid starter set", () => {
      const c = ctx(9);
      const { player } = toBook(9);
      for (let i = 0; i < 10; i++)
        applyAction(player, "book", { type: "choice", index: 1 }, c);
      applyAction(player, "book", { type: "choice", index: 0 }, c);
      const owned = Object.keys(player.cards).map((id) => CARD_INDEX.get(id)!);
      expect(owned).toHaveLength(12);
      expect(owned.filter((x) => x.rarity === "eternal")).toHaveLength(2);
      expect(player.story!.pack!.rerolls).toBe(10);
    });
  });

  describe("the first chapter (cave duel)", () => {
    // Walk an Eye all the way into cave_battle.
    const toCave = (seed = 1) =>
      play([0, "abyss", 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0], seed);

    it("praises the lucky draw, opens the map to Bò Tuôi, and chains to the cave battle", () => {
      const { player, events } = toCave();
      expect(events.every((e) => e.ok)).toBe(true);
      expect(player.story!.node).toBe("cave_battle");
      expect(player.story!.chapter).toBe("bo-tuoi");
      // the battle node is a flagged, text-less view
      const view = currentView(player, ctx());
      expect(view.battle).toBeDefined();
      expect(view.lines).toEqual([]);
      expect(view.choices).toEqual([]);
    });

    it("to_bo_tuoi offers the Bò Tuôi arrow and a locked way back to Wisdom", () => {
      // stop at to_bo_tuoi: ... book_taken -> deck_praise -> to_bo_tuoi
      const { player } = play([0, "abyss", 0, 0, 0, 0, 0, 1, 0, 0, 0], 1);
      expect(player.story!.node).toBe("to_bo_tuoi");
      const view = currentView(player, ctx());
      expect(view.map!.locations.map((l) => l.name)).toEqual([
        PLACE_WISDOM,
        "The Crossroads",
        TRIBE,
      ]);
      // choosing Wisdom (index 0) is the locked detour, Bò Tuôi (index 1) goes on
      applyAction(player, "to_bo_tuoi", { type: "choice", index: 0 }, ctx());
      expect(player.story!.node).toBe("wisdom_locked");
      applyAction(player, "wisdom_locked", { type: "choice", index: 0 }, ctx());
      expect(player.story!.node).toBe("to_bo_tuoi");
      applyAction(player, "to_bo_tuoi", { type: "choice", index: 1 }, ctx());
      expect(player.story!.node).toBe("sea_cliff");
    });

    it("reveal_face carries the inside man's portrait", () => {
      // walk to reveal_face: ... cave_mouth -> reveal_face
      const { player } = play(
        [0, "abyss", 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
        1,
      );
      expect(player.story!.node).toBe("reveal_face");
      expect(currentView(player, ctx()).portrait).toEqual({
        assetKey: "boss-spd-story",
        alt: "Bò SPD",
      });
    });

    it("refusing the terms coerces into two accept buttons, both leading to the battle", () => {
      // walk to cave_terms then refuse
      const { player } = play(
        [0, "abyss", 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        1,
      );
      expect(player.story!.node).toBe("cave_refuse");
      const view = currentView(player, ctx());
      expect(view.choices.map((c) => c.label)).toEqual([
        "...I accept",
        "...I accept",
      ]);
      applyAction(player, "cave_refuse", { type: "choice", index: 1 }, ctx());
      expect(player.story!.node).toBe("cave_battle");
    });

    it("resolveStoryBattle moves to chapter_end on a win (sets caveWon, clears battle)", () => {
      const { player } = toCave();
      player.story!.battle = {
        kind: "cave",
        state: {} as never,
        selectedUid: null,
        log: [],
        difficulty: "normal",
        opponentPortrait: "boss-spd-battle",
      };
      const result = resolveStoryBattle(player, "won", ctx());
      expect(result.ok).toBe(true);
      expect(player.story!.node).toBe("chapter_end");
      expect(player.story!.caveWon).toBe(true);
      expect(player.story!.battle).toBeNull();
      expect(currentView(player, ctx()).choices).toEqual([]);
    });

    it("resolveStoryBattle moves to cave_loss on a loss (keeps battle), and retry clears it and returns to the battle", () => {
      const { player } = toCave();
      player.story!.battle = {
        kind: "cave",
        state: {} as never,
        selectedUid: null,
        log: [],
        difficulty: "normal",
        opponentPortrait: "boss-spd-battle",
      };
      const result = resolveStoryBattle(player, "lost", ctx());
      expect(result.ok).toBe(true);
      expect(player.story!.node).toBe("cave_loss");
      expect(player.story!.caveWon).toBe(false);
      expect(player.story!.battle).not.toBeNull();
      // retry: "Try again" clears the lost snapshot and returns to cave_battle
      applyAction(player, "cave_loss", { type: "choice", index: 0 }, ctx());
      expect(player.story!.node).toBe("cave_battle");
      expect(player.story!.battle).toBeNull();
    });

    it("resolveStoryBattle refuses when not on the battle node or with no battle", () => {
      const { player } = toCave();
      // no battle snapshot
      expect(resolveStoryBattle(player, "won", ctx())).toEqual({
        ok: false,
        reason: "invalid",
      });
    });
  });

  it("ignores old buttons: an action for a scene the player has left changes nothing", () => {
    const c = ctx();
    const player = createPlayer("p");
    ensureStory(player, c);
    applyAction(player, "greeting", { type: "choice", index: 1 }, c);
    const before = structuredClone(player.story);
    expect(
      applyAction(player, "greeting", { type: "choice", index: 0 }, c),
    ).toEqual({ ok: false, reason: "stale" });
    expect(player.story).toEqual(before);
  });

  it("rejects an out-of-range choice, a form on a scene without one, and actions before the story starts", () => {
    const c = ctx();
    const player = createPlayer("p");
    expect(
      applyAction(player, "greeting", { type: "choice", index: 0 }, c),
    ).toEqual({ ok: false, reason: "no-story" });
    ensureStory(player, c);
    expect(
      applyAction(player, "greeting", { type: "choice", index: 5 }, c),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      applyAction(player, "greeting", { type: "choice", index: -1 }, c),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      applyAction(player, "greeting", { type: "text", text: "hello" }, c),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(player.story!.node).toBe("greeting");
  });

  it("the story state survives being saved and loaded as JSON", () => {
    const { player } = play([0, "abiss"], 4);
    const loaded = JSON.parse(JSON.stringify(player)) as Player;
    expect(currentView(loaded, ctx()).lines.map((l) => l.text)).toEqual(
      currentView(player, ctx()).lines.map((l) => l.text),
    );
  });

  it("every scene fits Discord: at most 5 buttons (4 on the map), labels up to 80 characters", () => {
    const c = ctx();
    const player = createPlayer("p");
    ensureStory(player, c);
    player.story!.name = "Ocean Eyes";
    player.story!.pendingName = {
      typed: "Abiss Eyes",
      suggestion: "Abyss Eyes",
    };
    player.story!.pack = {
      cards: drawStarterPack(COLLECTIBLE_CARDS, mulberry32(1)).map((x) => x.id),
      rerolls: 0,
    };
    for (const id of Object.keys(NODES)) {
      player.story!.node = id;
      const view = currentView(player, c);
      if (view.battle) continue; // battle scenes render no story text (lines:[], choices:[])
      expect(view.choices.length, id).toBeLessThanOrEqual(view.map ? 4 : 5);
      for (const choice of view.choices)
        expect(
          choice.label.length,
          `${id}: ${choice.label}`,
        ).toBeLessThanOrEqual(80);
      expect(view.lines.length, id).toBeGreaterThan(0);
      if (view.input) {
        expect(view.input.modalTitle.length).toBeLessThanOrEqual(45);
        expect(view.input.label.length).toBeLessThanOrEqual(45);
        expect(view.input.buttonLabel.length).toBeLessThanOrEqual(80);
      }
    }
  });
});

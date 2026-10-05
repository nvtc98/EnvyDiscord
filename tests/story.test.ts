import { describe, expect, it } from "vitest";
import { CARDS, CARD_INDEX } from "../src/data/cards";
import type { CardDef } from "../src/engine/types";
import { STARTER_SIZE, drawStarterPack } from "../src/game/starter";
import { createPlayer, type Player } from "../src/game/player";
import { applyAction, currentView, ensureStory } from "../src/story/engine";
import { cleanStem, displayName, matchName } from "../src/story/names";
import { NODES, PLACE_WISDOM, STRANGER, TRIBE } from "../src/story/prologue";
import type { StoryContext } from "../src/story/types";
import { mulberry32 } from "../src/util/rng";

const NAMES = CARDS.map((c) => c.name);
const ctx = (seed = 1): StoryContext => ({
  rng: mulberry32(seed),
  cards: CARDS,
  cardIndex: CARD_INDEX,
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
    epic: pack.filter((c) => c.rarity === "epic").length,
    rare: pack.filter((c) => c.rarity === "rare").length,
    common: pack.filter((c) => c.rarity === "common").length,
  });

  it("is always 12 different cards: 2 epic, 2 rare and 8 common", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const pack = drawStarterPack(CARDS, mulberry32(seed));
      expect(pack).toHaveLength(STARTER_SIZE);
      expect(new Set(pack.map((c) => c.id)).size).toBe(12);
      expect(rarityCounts(pack)).toEqual({ epic: 2, rare: 2, common: 8 });
    }
  });

  it("differs between draws", () => {
    const rng = mulberry32(5);
    const a = drawStarterPack(CARDS, rng)
      .map((c) => c.id)
      .sort()
      .join();
    const b = drawStarterPack(CARDS, rng)
      .map((c) => c.id)
      .sort()
      .join();
    expect(a).not.toBe(b);
  });

  it("fails loudly when the card list cannot supply the mix", () => {
    expect(() =>
      drawStarterPack(
        CARDS.filter((c) => c.rarity !== "epic"),
        mulberry32(1),
      ),
    ).toThrow(/epic/);
  });

  it("every card in the list has a rarity, a cost and a power", () => {
    for (const c of CARDS) {
      expect(["common", "rare", "epic"]).toContain(c.rarity);
      expect(c.cost).toBeGreaterThanOrEqual(1);
      expect(c.power).toBeGreaterThanOrEqual(1);
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

  it("walks the whole prologue as an Eye who knows the way, from the greeting to the end", () => {
    // yes (an Eye), a name from the list, continue, knows the tribe, continue through curse, informant, map,
    // wisdom (ask how he knows), wisdom_ask (open the book), book (take), book_taken (continue)
    const { player, events } = play([0, "abyss", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(events.every((e) => e.ok)).toBe(true);
    expect(player.story).toMatchObject({
      node: "prologue_end",
      isEye: true,
      name: "Abyss Eyes",
      knowsTribe: true,
      starterClaimed: true,
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
      "Aye, I am Abyss Eyes",
      "I shall speak it again",
      "Aye, I am Abiss Eyes",
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

  it("saying no to The Eyes skips the name and changes nothing else", () => {
    const { player } = play([1]);
    expect(player.story).toMatchObject({
      isEye: false,
      name: null,
      node: "not_eye",
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

    const stranger = play([1, 0, 1]); // not an eye, continue, "no"
    expect(stranger.player.story!.node).toBe("tribe_unknown_stranger");
    expect(currentView(stranger.player, ctx()).lines[0].text).toMatch(
      /search together/,
    );

    const knows = play([1, 0, 0]);
    expect(knows.player.story!.node).toBe("tribe_known");
    expect(knows.player.story!.knowsTribe).toBe(true);
  });

  it("every path reaches the curse and the Informant, and the tribe name is spelled with its Vietnamese letters", () => {
    for (const steps of [
      [1, 0, 1, 0],
      [1, 0, 0, 0],
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
    const { player } = play([1, 0, 1, 0, 0, 0]); // ... curse -> informant -> map
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
    // not an Eye ... map -> wisdom; "Just open the book" (index 1) -> book
    const toBook = (seed = 1) => play([1, 0, 1, 0, 0, 0, 0, 1], seed);
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
        "Close the tome and open it anew",
      ]);
    });

    it("closing and reopening shows a different twelve with the same mix, counts the tries, and the Informant reacts", () => {
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
        expect(pack.filter((x) => x.rarity === "epic")).toHaveLength(2);
        expect(pack.filter((x) => x.rarity === "rare")).toHaveLength(2);
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
      expect(player.story!.node).toBe("prologue_end");
      expect(currentView(player, c).choices).toEqual([]);
    });

    it("rerolling many times and then taking still gives a valid starter set", () => {
      const c = ctx(9);
      const { player } = toBook(9);
      for (let i = 0; i < 10; i++)
        applyAction(player, "book", { type: "choice", index: 1 }, c);
      applyAction(player, "book", { type: "choice", index: 0 }, c);
      const owned = Object.keys(player.cards).map((id) => CARD_INDEX.get(id)!);
      expect(owned).toHaveLength(12);
      expect(owned.filter((x) => x.rarity === "epic")).toHaveLength(2);
      expect(player.story!.pack!.rerolls).toBe(10);
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
      cards: drawStarterPack(CARDS, mulberry32(1)).map((x) => x.id),
      rerolls: 0,
    };
    for (const id of Object.keys(NODES)) {
      player.story!.node = id;
      const view = currentView(player, c);
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

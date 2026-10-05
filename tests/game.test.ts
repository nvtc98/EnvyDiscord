import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CARDS, CARD_INDEX } from "../src/data/cards";
import { JsonPlayerRepo } from "../src/db/json-repo";
import { DECK_SIZE } from "../src/engine/types";
import { opponentDeck, ownedCards, resolveDeck } from "../src/game/deck";
import { DAILY_COINS, claimDaily, drawPack, todayKey } from "../src/game/gacha";
import {
  DUPLICATE_REBATE,
  createPlayer,
  grantCard,
  receivable,
} from "../src/game/player";
import { variantOrder } from "../src/data/variants";
import { applyBattleResult } from "../src/game/rewards";
import { mulberry32 } from "../src/util/rng";

const ALL_VARIANTS = variantOrder();

describe("grantCard and variants", () => {
  it("a new card is granted as metal and active metal", () => {
    const player = createPlayer("u");
    const card = CARDS[0];
    expect(grantCard(player, card)).toMatchObject({
      kind: "new",
      variant: "metal",
    });
    expect(player.cards[card.id]).toEqual({
      variants: ["metal"],
      active: "metal",
    });
  });

  it("each duplicate unlocks the next variant in registry order, keeping the active variant", () => {
    const player = createPlayer("u");
    const card = CARDS[0];
    grantCard(player, card); // new -> metal
    for (const variant of ALL_VARIANTS.slice(1)) {
      expect(grantCard(player, card)).toMatchObject({
        kind: "variant-unlocked",
        variant,
      });
    }
    expect(player.cards[card.id].variants).toEqual([...ALL_VARIANTS]);
    expect(player.cards[card.id].active).toBe("metal"); // active is unchanged by unlocks
  });

  it("once every variant is owned, a further duplicate refunds coins and leaves the set full", () => {
    const player = createPlayer("u");
    const card = CARDS[0];
    for (let i = 0; i < ALL_VARIANTS.length; i++) grantCard(player, card); // fill all variants
    const coinsBefore = player.coins;
    const result = grantCard(player, card);
    expect(result).toMatchObject({
      kind: "duplicate-refunded",
      refund: DUPLICATE_REBATE,
    });
    expect(player.coins).toBe(coinsBefore + DUPLICATE_REBATE);
    expect(player.cards[card.id].variants).toEqual([...ALL_VARIANTS]);
  });

  it("a card with every variant owned can no longer be received; a card missing a variant still can", () => {
    const player = createPlayer("u");
    player.cards[CARDS[0].id] = {
      variants: [...ALL_VARIANTS],
      active: "metal",
    };
    player.cards[CARDS[1].id] = {
      variants: [...ALL_VARIANTS.slice(0, -1)],
      active: "metal",
    };
    const ids = receivable(player, CARDS).map((c) => c.id);
    expect(ids).not.toContain(CARDS[0].id);
    expect(ids).toContain(CARDS[1].id);
    expect(ids).toContain(CARDS[2].id); // unowned
  });
});

describe("drawPack", () => {
  it("returns distinct cards, uniformly from the pool, and no more than the pool has", () => {
    for (let seed = 0; seed < 30; seed++) {
      const pack = drawPack(CARDS, mulberry32(seed));
      expect(new Set(pack.map((c) => c.id)).size).toBe(3);
    }
    expect(drawPack(CARDS.slice(0, 2), mulberry32(1))).toHaveLength(2);
    const counts = new Map<string, number>();
    const rng = mulberry32(5);
    const draws = 40_000;
    for (let i = 0; i < draws; i++)
      for (const c of drawPack(CARDS, rng, 1))
        counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
    const mean = draws / CARDS.length;
    for (const c of CARDS) {
      expect(counts.get(c.id) ?? 0, c.id).toBeGreaterThan(mean * 0.5); // no card is starved...
      expect(counts.get(c.id)!, c.id).toBeLessThan(mean * 1.6); // ...or favoured: rarity does not bias ordinary packs
    }
  });
});

describe("claimDaily", () => {
  it("works once per day, gives coins, and makes new cards and variant unlocks", () => {
    const player = createPlayer("u");
    const rng = mulberry32(3);
    const first = claimDaily(player, CARDS, "2026-10-04", rng);
    expect(first.ok).toBe(true);
    expect(claimDaily(player, CARDS, "2026-10-04", rng)).toEqual({
      ok: false,
      reason: "already-claimed",
    });
    expect(player.coins).toBe(DAILY_COINS);
    expect(Object.keys(player.cards)).toHaveLength(3);
    for (let day = 5; day < 40; day++)
      claimDaily(player, CARDS, `2026-10-${day}`, rng);
    // Some card has been received more than once, so it owns more than just metal.
    expect(Object.values(player.cards).some((c) => c.variants.length > 1)).toBe(
      true,
    );
    // Every owned card always owns metal, and its active variant is one it owns.
    expect(
      Object.values(player.cards).every(
        (c) => c.variants.includes("metal") && c.variants.includes(c.active),
      ),
    ).toBe(true);
  });

  it("a card with all variants is never given, and a fully complete collection gives nothing and keeps the day free", () => {
    const player = createPlayer("u");
    for (const c of CARDS)
      player.cards[c.id] = { variants: [...ALL_VARIANTS], active: "metal" };
    player.cards[CARDS[0].id] = {
      variants: [...ALL_VARIANTS.slice(0, -1)],
      active: "metal",
    }; // missing one
    const rng = mulberry32(8);
    const result = claimDaily(player, CARDS, "2026-10-04", rng);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.grants).toHaveLength(1); // only one card can still be received
      expect(result.grants[0].card.id).toBe(CARDS[0].id);
    }
    expect(player.cards[CARDS[0].id].variants).toEqual([...ALL_VARIANTS]); // now complete

    const coins = player.coins;
    expect(claimDaily(player, CARDS, "2026-10-05", rng)).toEqual({
      ok: false,
      reason: "collection-complete",
    });
    expect(player.lastDaily).toBe("2026-10-04"); // not used up
    expect(player.coins).toBe(coins);
  });

  it("todayKey uses the given timezone", () => {
    const instant = new Date("2026-10-01T20:00:00Z"); // 03:00 on Oct 2 in Vietnam
    expect(todayKey(instant, "Asia/Ho_Chi_Minh")).toBe("2026-10-02");
    expect(todayKey(instant, "UTC")).toBe("2026-10-01");
  });
});

describe("decks", () => {
  const rng = () => mulberry32(11);

  it("uses a complete saved deck as is", () => {
    const player = createPlayer("u");
    for (const c of CARDS)
      player.cards[c.id] = { variants: ["metal"], active: "metal" };
    player.deck = CARDS.slice(3, 3 + DECK_SIZE).map((c) => c.id);
    const deck = resolveDeck(player, CARDS, CARD_INDEX, rng());
    expect(deck.cards.map((c) => c.id)).toEqual(player.deck);
    expect(deck.guests).toEqual([]);
  });

  it("keeps valid saved cards, fills from the other owned cards, and never repeats a card", () => {
    const player = createPlayer("u");
    for (const c of CARDS)
      player.cards[c.id] = { variants: ["metal"], active: "metal" };
    player.deck = [CARDS[0].id, CARDS[1].id, "not-a-real-card"];
    const deck = resolveDeck(player, CARDS, CARD_INDEX, rng());
    const ids = deck.cards.map((c) => c.id);
    expect(ids.slice(0, 2)).toEqual([CARDS[0].id, CARDS[1].id]);
    expect(new Set(ids).size).toBe(DECK_SIZE);
    expect(deck.guests).toEqual([]); // the player owns every card, so no guests are needed
  });

  it("a new player gets guest cards, which are never cards they own and never added to the collection", () => {
    const player = createPlayer("u");
    player.cards[CARDS[0].id] = { variants: ["metal"], active: "metal" };
    player.cards[CARDS[1].id] = { variants: ["metal", "blue"], active: "blue" };
    const deck = resolveDeck(player, CARDS, CARD_INDEX, rng());
    expect(deck.cards).toHaveLength(DECK_SIZE);
    expect(deck.guests).toHaveLength(DECK_SIZE - 2);
    expect(
      deck.guests.every((g) => g.id !== CARDS[0].id && g.id !== CARDS[1].id),
    ).toBe(true);
    expect(new Set(deck.cards.map((c) => c.id)).size).toBe(DECK_SIZE);
    expect(Object.keys(player.cards)).toHaveLength(2);
  });

  it("ignores a saved deck card the player does not own", () => {
    const player = createPlayer("u");
    player.cards[CARDS[0].id] = { variants: ["metal"], active: "metal" };
    player.deck = [CARDS[5].id];
    const deck = resolveDeck(player, CARDS, CARD_INDEX, rng());
    expect(deck.cards.slice(0, 1).map((c) => c.id)).toEqual([CARDS[0].id]);
    // The unowned card is not kept for being in the saved deck: it can only be there as a random guest.
    const unowned = deck.cards.find((c) => c.id === CARDS[5].id);
    if (unowned) expect(deck.guests).toContain(unowned);
  });

  it("ownedCards sorts by cost then name; opponentDeck has 12 different cards", () => {
    const player = createPlayer("u");
    for (const c of CARDS)
      player.cards[c.id] = { variants: ["metal"], active: "metal" };
    const costs = ownedCards(player, CARD_INDEX).map((o) => o.def.cost);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    expect(new Set(opponentDeck(CARDS, rng()).map((c) => c.id)).size).toBe(
      DECK_SIZE,
    );
  });
});

describe("rewards", () => {
  it("records wins and losses and awards coins by difficulty", () => {
    const player = createPlayer("u");
    expect(applyBattleResult(player, "hard", "won")).toBe(80);
    expect(applyBattleResult(player, "easy", "lost")).toBe(5);
    expect(applyBattleResult(player, "normal", "draw")).toBe(10);
    expect(player).toMatchObject({ wins: 1, losses: 1, coins: 95 });
  });
});

describe("JsonPlayerRepo", () => {
  it("persists across reopen and returns copies", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cardbot-"));
    const path = join(dir, "nested", "players.json");
    const repo = await JsonPlayerRepo.open(path);
    const player = repo.get("u1");
    expect(player.coins).toBe(0);
    player.coins = 99;
    expect(repo.get("u1").coins).toBe(0); // not saved yet
    await repo.save(player);
    await repo.flush();

    const reopened = await JsonPlayerRepo.open(path);
    expect(reopened.get("u1").coins).toBe(99);
    expect(JSON.parse(await readFile(path, "utf8")).players.u1.coins).toBe(99);
  });

  it("upgrades a save file from the 3v3 game: adds `deck`, drops `team`, keeps cards and coins", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cardbot-"));
    const path = join(dir, "players.json");
    await writeFile(
      path,
      JSON.stringify({
        players: {
          u: {
            id: "u",
            coins: 120,
            wins: 3,
            losses: 1,
            lastDaily: "2026-10-01",
            cards: { "tho-lua": 3 },
            team: ["tho-lua", "ca-chep", "nam-con"],
          },
        },
      }),
    );
    const player = (await JsonPlayerRepo.open(path)).get("u");
    expect(player).toMatchObject({
      coins: 120,
      wins: 3,
      // The legacy tier (3) is discarded; the card becomes metal in the variant model.
      cards: { "tho-lua": { variants: ["metal"], active: "metal" } },
      deck: [],
    });
    expect("team" in player).toBe(false);
  });

  it("serializes concurrent saves; the last one wins", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cardbot-"));
    const path = join(dir, "players.json");
    const repo = await JsonPlayerRepo.open(path);
    const saves = [1, 2, 3, 4, 5].map((n) => {
      const p = repo.get("u");
      p.coins = n;
      return repo.save(p);
    });
    await Promise.all(saves);
    expect((await JsonPlayerRepo.open(path)).get("u").coins).toBe(5);
  });

  it("refuses to start on a corrupt file instead of wiping it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cardbot-"));
    const path = join(dir, "players.json");
    await writeFile(path, "{ not json");
    await expect(JsonPlayerRepo.open(path)).rejects.toThrow(/Could not read/);
    expect(await readFile(path, "utf8")).toBe("{ not json");
  });
});

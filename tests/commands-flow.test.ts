import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CARDS, COLLECTIBLE_CARDS } from "../src/data/cards";
import { collectionCommand } from "../src/discord/commands/collection";
import { dailyCommand } from "../src/discord/commands/daily";
import { deckCommand } from "../src/discord/commands/deck";
import { cardCommand } from "../src/discord/commands/card";
import { shopCommand } from "../src/discord/commands/shop";
import { profileCommand } from "../src/discord/commands/profile";
import {
  resetLiveGateMessages,
  setStorySleep,
  storyCommand,
} from "../src/discord/commands/story";
import { SHOP_CARD_PRICE, SHOP_VARIANT_PRICE } from "../src/game/shop";
import { DAILY_COINS, todayKey } from "../src/game/gacha";
import { DECK_SIZE } from "../src/engine/types";
import { CARD_INDEX } from "../src/data/cards";
import {
  buttonInteraction,
  embedOf,
  lastPayload,
  makeCtx,
  ownEverything,
  ownEveryVariant,
  rows,
  selectInteraction,
  slashInteraction,
  unlockDaily,
} from "./discord-helpers";

describe("/daily", () => {
  it("stays locked until the player has taken their first cards in the story", async () => {
    const ctx = makeCtx(2);
    const call = slashInteraction("u");
    await dailyCommand.execute(call as never, ctx);
    expect(lastPayload(call.reply).content).toMatch(/\/story/);
    expect(ctx.repo.get("u").cards).toEqual({});
    expect(ctx.repo.get("u").coins).toBe(0);
  });

  it("gives three cards, then refuses a second claim the same day", async () => {
    const ctx = makeCtx(2);
    unlockDaily(ctx, "u");
    const first = slashInteraction("u");
    await dailyCommand.execute(first as never, ctx);
    expect(embedOf(lastPayload(first.reply)).description).toMatch(/🆕/);
    expect(Object.keys(ctx.repo.get("u").cards)).toHaveLength(3);
    expect(ctx.repo.get("u").coins).toBe(DAILY_COINS);
    expect(DAILY_COINS).toBe(20);
    // The footer reads in gold, with no "coin" wording.
    const footer = embedOf(lastPayload(first.reply)).footer.text as string;
    expect(footer).toMatch(/gold/);
    expect(footer).not.toMatch(/coin/i);
    expect(
      ctx.log.entries.find((e) => e.type === "daily_claimed"),
    ).toBeDefined();

    const second = slashInteraction("u");
    await dailyCommand.execute(second as never, ctx);
    expect(lastPayload(second.reply).content).toMatch(/already claimed/);
  });

  it("says the collection is complete once every card owns every variant, and gives nothing", async () => {
    const ctx = makeCtx(2);
    ownEveryVariant(ctx, "u");
    unlockDaily(ctx, "u");
    const call = slashInteraction("u");
    await dailyCommand.execute(call as never, ctx);
    expect(lastPayload(call.reply).content).toMatch(/collection is complete/);
    expect(ctx.repo.get("u").coins).toBe(0);
  });
});

describe("/daily -> post-victory story hook", () => {
  beforeEach(() => {
    resetLiveGateMessages();
    setStorySleep(async () => {}); // no real typing timers
  });
  afterEach(() => {
    setStorySleep();
  });

  /** A player parked at victory_roster waiting on /daily (starter claimed so /daily is open). */
  function parkAtRoster(ctx: ReturnType<typeof makeCtx>, userId = "u"): void {
    const player = ctx.repo.get(userId);
    player.story = {
      node: "victory_roster",
      name: "Abyss Eyes",
      isEye: true,
      knowsTribe: true,
      nameAttempts: [],
      pendingName: null,
      notice: null,
      pack: null,
      starterClaimed: true,
      liveMessageId: null,
      chapter: "bo-tuoi",
      battle: null,
      caveWon: true,
      awaitingDaily: true,
      tutorial: {},
    };
    void ctx.repo.save(player);
  }

  /** The DM messages that carry text content (the story bubbles). */
  const dmTexts = (dm: ReturnType<typeof slashInteraction>["dm"]): string[] =>
    (dm?.sent ?? [])
      .map((p: any) => p.content)
      .filter((c: any): c is string => typeof c === "string");

  it("a successful claim while parked grants 3 cards + 20 gold AND advances the story once", async () => {
    const ctx = makeCtx(2);
    parkAtRoster(ctx, "u");
    const call = slashInteraction("u");
    await dailyCommand.execute(call as never, ctx);

    const player = ctx.repo.get("u");
    expect(Object.keys(player.cards)).toHaveLength(3);
    expect(player.coins).toBe(DAILY_COINS);
    // The story advanced to victory_daily_done and the flag cleared.
    expect(player.story!.node).toBe("victory_daily_done");
    expect(player.story!.awaitingDaily).toBe(false);
    // A story DM bubble was delivered carrying the victory_daily_done line.
    expect(dmTexts(call.dm).some((t) => /do this each day/i.test(t))).toBe(
      true,
    );
  });

  it("a normal /daily on a non-parked player delivers NO story DM", async () => {
    const ctx = makeCtx(2);
    unlockDaily(ctx, "u"); // node: chapter_end, awaitingDaily unset
    const call = slashInteraction("u");
    await dailyCommand.execute(call as never, ctx);

    const player = ctx.repo.get("u");
    expect(Object.keys(player.cards)).toHaveLength(3);
    expect(player.story!.node).toBe("chapter_end"); // untouched
    expect(dmTexts(call.dm).some((t) => /do this each day/i.test(t))).toBe(
      false,
    );
  });

  it("the hook fires only once: a second same-day claim is blocked and never re-advances", async () => {
    const ctx = makeCtx(2);
    parkAtRoster(ctx, "u");
    const first = slashInteraction("u");
    await dailyCommand.execute(first as never, ctx);
    expect(ctx.repo.get("u").story!.node).toBe("victory_daily_done");

    // Advance the player off the daily_done node so we can prove a later daily does not re-trigger.
    const mid = ctx.repo.get("u");
    mid.story!.node = "chapter_end";
    void ctx.repo.save(mid);

    const second = slashInteraction("u");
    await dailyCommand.execute(second as never, ctx);
    expect(lastPayload(second.reply).content).toMatch(/already claimed/);
    // Still on chapter_end; the already-claimed path never runs the hook.
    expect(ctx.repo.get("u").story!.node).toBe("chapter_end");
  });

  it("already-claimed-today: the fallback button advances with no second claim (gold unchanged)", async () => {
    const ctx = makeCtx(2);
    parkAtRoster(ctx, "u");
    // Pretend the player already claimed earlier today.
    const player = ctx.repo.get("u");
    player.lastDaily = todayKey(new Date(), ctx.timezone);
    player.coins = 55;
    void ctx.repo.save(player);

    // /daily returns already-claimed and the hook never runs.
    const call = slashInteraction("u");
    await dailyCommand.execute(call as never, ctx);
    expect(lastPayload(call.reply).content).toMatch(/already claimed/);
    expect(ctx.repo.get("u").story!.node).toBe("victory_roster"); // still parked
    expect(ctx.repo.get("u").coins).toBe(55);

    // The fallback button on victory_roster advances the story with no claim.
    const press = buttonInteraction("u", "story:victory_roster:c:0");
    (press as any).message = { id: "x" };
    (press as any).channel = call.dm;
    await storyCommand.component!(press as never, ctx);
    const advanced = ctx.repo.get("u");
    expect(advanced.story!.node).toBe("victory_daily_done");
    expect(advanced.story!.awaitingDaily).toBe(false);
    expect(advanced.coins).toBe(55); // no gold farmed
  });
});

describe("/collection", () => {
  it("shows three cards per page with working page buttons, and the counts in the footer", async () => {
    const ctx = makeCtx(2);
    ownEverything(ctx, "u", "blue");
    const call = slashInteraction("u");
    await collectionCommand.execute(call as never, ctx);
    let payload = lastPayload(call.reply);
    expect(embedOf(payload).fields).toHaveLength(3);
    expect(embedOf(payload).footer.text).toMatch(
      new RegExp(
        `Page 1/${Math.ceil(COLLECTIBLE_CARDS.length / 3)} · Owned ${COLLECTIBLE_CARDS.length}/${COLLECTIBLE_CARDS.length}`,
      ),
    );
    expect(rows(payload)[0].components.map((c: any) => c.disabled)).toEqual([
      true,
      false,
    ]);

    const next = buttonInteraction("u", "collection:1");
    await collectionCommand.component!(next as never, ctx);
    payload = lastPayload(next.update);
    expect(embedOf(payload).footer.text).toMatch(/Page 2\//);
    expect(payload.attachments).toEqual([]);
  });

  it("invites a new player to claim their first cards", async () => {
    const call = slashInteraction("nobody");
    await collectionCommand.execute(call as never, makeCtx());
    expect(embedOf(lastPayload(call.reply)).description).toMatch(/\/daily/);
  });

  it("shows another player's cards read-only and threads the target through paging", async () => {
    const ctx = makeCtx(2);
    ownEverything(ctx, "friend", "metal");
    const call = slashInteraction("viewer", { user: "friend" });
    await collectionCommand.execute(call as never, ctx);
    let payload = lastPayload(call.reply);
    expect(embedOf(payload).fields).toHaveLength(3);
    // The page buttons carry the target id so paging keeps viewing the same person.
    expect(rows(payload)[0].components[1].custom_id).toBe(
      "collection:1:friend",
    );

    const next = buttonInteraction("viewer", "collection:1:friend");
    await collectionCommand.component!(next as never, ctx);
    payload = lastPayload(next.update);
    expect(embedOf(payload).footer.text).toMatch(/Page 2\//);
  });

  it("tells you when the player you asked about has never started", async () => {
    const ctx = makeCtx();
    const call = slashInteraction("viewer", { user: "stranger" });
    await collectionCommand.execute(call as never, ctx);
    expect(lastPayload(call.reply).content).toMatch(/hasn't started/);
  });
});

describe("/deck", () => {
  it("explains how guests work when the player owns fewer than 12 cards", async () => {
    const ctx = makeCtx();
    const call = slashInteraction("u");
    await deckCommand.execute(call as never, ctx);
    expect(lastPayload(call.reply).content).toMatch(/guest cards/);
    expect(lastPayload(call.reply).components).toBeUndefined();
  });

  it("offers exactly 12 picks, and saves the chosen deck", async () => {
    const ctx = makeCtx();
    ownEverything(ctx, "u");
    const call = slashInteraction("u");
    await deckCommand.execute(call as never, ctx);
    const menu = rows(lastPayload(call.reply))[0].components[0];
    expect([menu.min_values, menu.max_values]).toEqual([DECK_SIZE, DECK_SIZE]);
    expect(menu.options).toHaveLength(25); // a select menu holds at most 25 options
    expect(lastPayload(call.reply).content).toMatch(
      new RegExp(`showing your 25 cheapest of ${COLLECTIBLE_CARDS.length}`),
    );

    const chosen = menu.options.slice(0, DECK_SIZE).map((o: any) => o.value);
    const pick = selectInteraction("u", "deck:select", chosen);
    await deckCommand.component!(pick as never, ctx);
    expect(ctx.repo.get("u").deck).toEqual(chosen);
    expect(lastPayload(pick.update).content).toMatch(/deck is set/);
    expect(ctx.log.entries.find((e) => e.type === "deck_set")).toBeDefined();
  });

  it("rejects a selection with the wrong size or cards the player does not own", async () => {
    const ctx = makeCtx();
    const player = ctx.repo.get("u");
    for (const c of CARDS.slice(0, 12))
      player.cards[c.id] = { variants: ["metal"], active: "metal" };
    await ctx.repo.save(player);
    const tooFew = selectInteraction(
      "u",
      "deck:select",
      CARDS.slice(0, 11).map((c) => c.id),
    );
    await deckCommand.component!(tooFew as never, ctx);
    expect(lastPayload(tooFew.update).content).toMatch(/won't work/);
    const notOwned = selectInteraction(
      "u",
      "deck:select",
      CARDS.slice(3, 15).map((c) => c.id),
    ); // includes cards 12..14
    await deckCommand.component!(notOwned as never, ctx);
    expect(lastPayload(notOwned.update).content).toMatch(/won't work/);
    expect(ctx.repo.get("u").deck).toEqual([]);
  });
});

describe("/card", () => {
  it("shows cost, power and ability, and whether you own it", async () => {
    const ctx = makeCtx();
    const call = slashInteraction("u", { name: "abyss eyes" });
    await cardCommand.execute(call as never, ctx);
    const embed = embedOf(lastPayload(call.reply));
    const def = CARD_INDEX.get("abyss-eyes")!;
    expect(embed.title).toBe("Abyss Eyes");
    expect(embed.description).toContain(`Cost ${def.cost}`);
    expect(embed.description).toContain(`Power ${def.power}`);
    expect(embed.footer.text).toMatch(/don't own/i);
  });

  it("says so when no card matches", async () => {
    const call = slashInteraction("u", { name: "nothing like this" });
    await cardCommand.execute(call as never, makeCtx());
    expect(lastPayload(call.reply).content).toMatch(/No card named/);
  });
});

describe("/profile", () => {
  it("counts only cards that still exist, ignoring ids left over from older card lists", async () => {
    const { profileCommand } = await import("../src/discord/commands/profile");
    const ctx = makeCtx();
    const player = ctx.repo.get("u");
    player.cards = {
      "abyss-eyes": { variants: ["metal"], active: "metal" },
      "tho-lua": { variants: ["metal", "blue"], active: "blue" },
      "long-gone-card": { variants: ["metal"], active: "metal" },
    };
    await ctx.repo.save(player);
    const call = slashInteraction("u");
    await profileCommand.execute(call as never, ctx);
    const cards = embedOf(lastPayload(call.reply)).fields.find((f: any) =>
      f.name.includes("Cards"),
    );
    expect(cards.value).toBe(`1/${COLLECTIBLE_CARDS.length}`);
  });

  it("shows another player's stats read-only using their display name", async () => {
    const { profileCommand } = await import("../src/discord/commands/profile");
    const ctx = makeCtx();
    const friend = ctx.repo.get("friend");
    friend.cards = { "abyss-eyes": { variants: ["metal"], active: "metal" } };
    friend.wins = 2;
    await ctx.repo.save(friend);
    const call = slashInteraction("viewer", { user: "friend" });
    await profileCommand.execute(call as never, ctx);
    const embed = embedOf(lastPayload(call.reply));
    expect(embed.title).toContain("User friend");
    const cards = embed.fields.find((f: any) => f.name.includes("Cards"));
    expect(cards.value).toBe(`1/${COLLECTIBLE_CARDS.length}`);
  });

  it("tells you when the profile you asked about has never started", async () => {
    const { profileCommand } = await import("../src/discord/commands/profile");
    const ctx = makeCtx();
    const call = slashInteraction("viewer", { user: "stranger" });
    await profileCommand.execute(call as never, ctx);
    expect(lastPayload(call.reply).content).toMatch(/hasn't started/);
  });
});

describe("/shop", () => {
  const abyss = CARD_INDEX.get("abyss-eyes")!;

  /** A player who owns abyss-eyes (metal) with the given coins. */
  function seedOwner(ctx: ReturnType<typeof makeCtx>, coins: number) {
    const player = ctx.repo.get("u");
    player.coins = coins;
    player.cards[abyss.id] = { variants: ["metal"], active: "metal" };
    void ctx.repo.save(player);
  }

  it("shows the gold balance and two in-voice buttons (no subcommand)", async () => {
    const json = shopCommand.data.toJSON() as any;
    expect(json.options ?? []).toEqual([]); // no subcommands/options left

    const ctx = makeCtx();
    seedOwner(ctx, 250);
    const call = slashInteraction("u");
    await shopCommand.execute(call as never, ctx);
    const payload = lastPayload(call.reply);
    expect(payload.content).toMatch(/250 gold/);
    expect(payload.content).not.toMatch(/coin/i);
    const buttons = rows(payload)[0].components;
    expect(buttons.map((b: any) => b.custom_id)).toEqual([
      "shop:summon",
      "shop:variant",
    ]);
    // The card button reads plainly as "Buy a card".
    expect(buttons[0].label).toMatch(/Buy/i);
    expect(buttons[0].label).not.toMatch(/Summon/i);
    // Both button labels read in gold, never coins.
    expect(buttons[0].label).toMatch(/gold/);
    expect(buttons[1].label).toMatch(/gold/);
    expect(buttons.every((b: any) => !/coin/i.test(b.label))).toBe(true);
  });

  it("summons a card via the button, deducting coins and saving it", async () => {
    const ctx = makeCtx();
    const player = ctx.repo.get("u");
    player.coins = 500;
    void ctx.repo.save(player);
    const before = Object.keys(ctx.repo.get("u").cards).length;

    const press = buttonInteraction("u", "shop:summon");
    await shopCommand.component!(press as never, ctx);
    expect(embedOf(lastPayload(press.reply)).title).toMatch(/bought/);
    // The result footer reads in gold, with no "coin" wording.
    const cardFooter = embedOf(lastPayload(press.reply)).footer.text as string;
    expect(cardFooter).toMatch(/gold/);
    expect(cardFooter).not.toMatch(/coin/i);
    const saved = ctx.repo.get("u");
    expect(Object.keys(saved.cards).length).toBe(before + 1);
    expect(saved.coins).toBe(500 - SHOP_CARD_PRICE);
    expect(SHOP_CARD_PRICE).toBe(100);
    expect(ctx.log.entries.find((e) => e.type === "shop_card")).toBeDefined();
  });

  it("refuses to summon when the player cannot afford a card", async () => {
    const ctx = makeCtx();
    const player = ctx.repo.get("u");
    player.coins = SHOP_CARD_PRICE - 1;
    void ctx.repo.save(player);
    const press = buttonInteraction("u", "shop:summon");
    await shopCommand.component!(press as never, ctx);
    expect(lastPayload(press.reply).content).toMatch(/need/);
    expect(ctx.repo.get("u").coins).toBe(SHOP_CARD_PRICE - 1);
  });

  it("buys a variant through the two-step select flow, deducting the flat price", async () => {
    const ctx = makeCtx();
    seedOwner(ctx, 500);

    const openPick = buttonInteraction("u", "shop:variant");
    await shopCommand.component!(openPick as never, ctx);
    const cardMenu = rows(lastPayload(openPick.reply))[0].components[0];
    expect(cardMenu.custom_id).toBe("shop:pickcard");
    expect(cardMenu.options.map((o: any) => o.value)).toContain(abyss.id);

    const pickCard = selectInteraction("u", "shop:pickcard", [abyss.id]);
    await shopCommand.component!(pickCard as never, ctx);
    const variantMenu = rows(lastPayload(pickCard.update))[0].components[0];
    expect(variantMenu.custom_id).toBe(`shop:pickvariant:${abyss.id}`);

    const pickVariant = selectInteraction("u", `shop:pickvariant:${abyss.id}`, [
      "blue",
    ]);
    await shopCommand.component!(pickVariant as never, ctx);
    expect(embedOf(lastPayload(pickVariant.update)).description).toMatch(
      /Blue/,
    );
    // The variant result footer reads in gold, with no "coin" wording.
    const variantFooter = embedOf(lastPayload(pickVariant.update)).footer
      .text as string;
    expect(variantFooter).toMatch(/gold/);
    expect(variantFooter).not.toMatch(/coin/i);
    const saved = ctx.repo.get("u");
    expect(saved.cards[abyss.id].variants).toContain("blue");
    expect(saved.coins).toBe(500 - SHOP_VARIANT_PRICE);
    expect(SHOP_VARIANT_PRICE).toBe(40);
    expect(
      ctx.log.entries.find((e) => e.type === "shop_variant"),
    ).toBeDefined();
  });

  it("the variant select offers only purchasable variants the player does not yet own", async () => {
    const ctx = makeCtx();
    const player = ctx.repo.get("u");
    player.coins = 500;
    player.cards[abyss.id] = { variants: ["metal", "blue"], active: "metal" };
    void ctx.repo.save(player);

    const pickCard = selectInteraction("u", "shop:pickcard", [abyss.id]);
    await shopCommand.component!(pickCard as never, ctx);
    const variantMenu = rows(lastPayload(pickCard.update))[0].components[0];
    // metal + blue are owned, so only purple + red remain.
    expect(variantMenu.options.map((o: any) => o.value)).toEqual([
      "purple",
      "red",
    ]);
  });

  it("tells the player no card awaits a hue when none is eligible", async () => {
    const ctx = makeCtx();
    const player = ctx.repo.get("u");
    player.coins = 500; // owns no cards
    void ctx.repo.save(player);
    const open = buttonInteraction("u", "shop:variant");
    await shopCommand.component!(open as never, ctx);
    expect(lastPayload(open.reply).content).toMatch(/no card/i);
  });

  it("refuses when the player already owns the chosen variant", async () => {
    const ctx = makeCtx();
    seedOwner(ctx, 500);
    const pick = selectInteraction("u", `shop:pickvariant:${abyss.id}`, [
      "metal",
    ]);
    await shopCommand.component!(pick as never, ctx);
    expect(lastPayload(pick.update).content).toMatch(/already own/);
    expect(ctx.repo.get("u").coins).toBe(500); // unchanged
  });

  it("refuses when the player does not own the card", async () => {
    const ctx = makeCtx();
    const player = ctx.repo.get("u");
    player.coins = 500;
    void ctx.repo.save(player);
    const pick = selectInteraction("u", `shop:pickvariant:${abyss.id}`, [
      "blue",
    ]);
    await shopCommand.component!(pick as never, ctx);
    expect(lastPayload(pick.update).content).toMatch(/don't own/i);
  });

  it("refuses when the player cannot afford the variant", async () => {
    const ctx = makeCtx();
    seedOwner(ctx, SHOP_VARIANT_PRICE - 1);
    const pick = selectInteraction("u", `shop:pickvariant:${abyss.id}`, [
      "blue",
    ]);
    await shopCommand.component!(pick as never, ctx);
    expect(lastPayload(pick.update).content).toMatch(/need/);
    expect(ctx.repo.get("u").cards[abyss.id].variants).toEqual(["metal"]);
  });
});

describe("/profile currency wording", () => {
  it("labels the balance field 'Gold', never 'Coins'", async () => {
    const ctx = makeCtx();
    const player = ctx.repo.get("u");
    player.coins = 123;
    void ctx.repo.save(player);
    const call = slashInteraction("u");
    await profileCommand.execute(call as never, ctx);
    const fields = embedOf(lastPayload(call.reply)).fields as {
      name: string;
      value: string;
    }[];
    const balance = fields.find((f) => /gold/i.test(f.name));
    expect(balance).toBeDefined();
    expect(balance!.value).toBe("123");
    expect(fields.every((f) => !/coin/i.test(f.name))).toBe(true);
  });
});

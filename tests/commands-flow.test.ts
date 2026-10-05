import { describe, expect, it } from "vitest";
import { CARDS } from "../src/data/cards";
import { collectionCommand } from "../src/discord/commands/collection";
import { dailyCommand } from "../src/discord/commands/daily";
import { deckCommand } from "../src/discord/commands/deck";
import { cardCommand } from "../src/discord/commands/card";
import { DECK_SIZE } from "../src/engine/types";
import { MAX_TIER } from "../src/game/player";
import { CARD_INDEX } from "../src/data/cards";
import {
  buttonInteraction,
  embedOf,
  lastPayload,
  makeCtx,
  ownEverything,
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
    expect(
      ctx.log.entries.find((e) => e.type === "daily_claimed"),
    ).toBeDefined();

    const second = slashInteraction("u");
    await dailyCommand.execute(second as never, ctx);
    expect(lastPayload(second.reply).content).toMatch(/already claimed/);
  });

  it("says the collection is complete once every card is at max tier, and gives nothing", async () => {
    const ctx = makeCtx(2);
    ownEverything(ctx, "u", MAX_TIER);
    unlockDaily(ctx, "u");
    const call = slashInteraction("u");
    await dailyCommand.execute(call as never, ctx);
    expect(lastPayload(call.reply).content).toMatch(/collection is complete/);
    expect(ctx.repo.get("u").coins).toBe(0);
  });
});

describe("/collection", () => {
  it("shows three cards per page with working page buttons, and the counts in the footer", async () => {
    const ctx = makeCtx(2);
    ownEverything(ctx, "u", 2);
    const call = slashInteraction("u");
    await collectionCommand.execute(call as never, ctx);
    let payload = lastPayload(call.reply);
    expect(embedOf(payload).fields).toHaveLength(3);
    expect(embedOf(payload).footer.text).toMatch(
      new RegExp(
        `Page 1/${Math.ceil(CARDS.length / 3)} · Owned ${CARDS.length}/${CARDS.length}`,
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
    ownEverything(ctx, "friend", 1);
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
      /showing your 25 cheapest of 229/,
    );

    const chosen = menu.options.slice(0, DECK_SIZE).map((o: any) => o.value);
    const pick = selectInteraction("u", "deck:select", chosen);
    await deckCommand.component!(pick as never, ctx);
    expect(ctx.repo.get("u").deck).toEqual(chosen);
    expect(lastPayload(pick.update).content).toMatch(/Deck saved/);
    expect(ctx.log.entries.find((e) => e.type === "deck_set")).toBeDefined();
  });

  it("rejects a selection with the wrong size or cards the player does not own", async () => {
    const ctx = makeCtx();
    const player = ctx.repo.get("u");
    for (const c of CARDS.slice(0, 12)) player.cards[c.id] = 1;
    await ctx.repo.save(player);
    const tooFew = selectInteraction(
      "u",
      "deck:select",
      CARDS.slice(0, 11).map((c) => c.id),
    );
    await deckCommand.component!(tooFew as never, ctx);
    expect(lastPayload(tooFew.update).content).toMatch(/Invalid selection/);
    const notOwned = selectInteraction(
      "u",
      "deck:select",
      CARDS.slice(3, 15).map((c) => c.id),
    ); // includes cards 12..14
    await deckCommand.component!(notOwned as never, ctx);
    expect(lastPayload(notOwned.update).content).toMatch(/Invalid selection/);
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
    expect(embed.footer.text).toMatch(/don't own/);
  });

  it("says so when no card matches", async () => {
    const call = slashInteraction("u", { name: "nothing like this" });
    await cardCommand.execute(call as never, makeCtx());
    expect(lastPayload(call.reply).content).toMatch(/not found/);
  });
});

describe("/profile", () => {
  it("counts only cards that still exist, ignoring ids left over from older card lists", async () => {
    const { profileCommand } = await import("../src/discord/commands/profile");
    const ctx = makeCtx();
    const player = ctx.repo.get("u");
    player.cards = { "abyss-eyes": 1, "tho-lua": 4, "long-gone-card": 2 };
    await ctx.repo.save(player);
    const call = slashInteraction("u");
    await profileCommand.execute(call as never, ctx);
    const cards = embedOf(lastPayload(call.reply)).fields.find((f: any) =>
      f.name.includes("Cards"),
    );
    expect(cards.value).toBe(`1/${CARDS.length}`);
  });

  it("shows another player's stats read-only using their display name", async () => {
    const { profileCommand } = await import("../src/discord/commands/profile");
    const ctx = makeCtx();
    const friend = ctx.repo.get("friend");
    friend.cards = { "abyss-eyes": 1 };
    friend.wins = 2;
    await ctx.repo.save(friend);
    const call = slashInteraction("viewer", { user: "friend" });
    await profileCommand.execute(call as never, ctx);
    const embed = embedOf(lastPayload(call.reply));
    expect(embed.title).toContain("User friend");
    const cards = embed.fields.find((f: any) => f.name.includes("Cards"));
    expect(cards.value).toBe(`1/${CARDS.length}`);
  });

  it("tells you when the profile you asked about has never started", async () => {
    const { profileCommand } = await import("../src/discord/commands/profile");
    const ctx = makeCtx();
    const call = slashInteraction("viewer", { user: "stranger" });
    await profileCommand.execute(call as never, ctx);
    expect(lastPayload(call.reply).content).toMatch(/hasn't started/);
  });
});

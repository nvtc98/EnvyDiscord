import { describe, expect, it } from "vitest";
import { adminCommand } from "../src/discord/commands/admin";
import { CARDS } from "../src/data/cards";
import {
  embedOf,
  lastPayload,
  makeCtx,
  slashInteraction,
} from "./discord-helpers";

/** Seed a player who has started the story and owns some cards. */
async function seedPlayer(
  ctx: ReturnType<typeof makeCtx>,
  id: string,
  node: string,
) {
  const player = ctx.repo.get(id);
  player.story = {
    node,
    name: "Ocean Eyes",
    isEye: true,
    knowsTribe: true,
    nameAttempts: [{ typed: "ocean", result: "exact" }],
    pendingName: null,
    notice: null,
    pack: null,
    starterClaimed: true,
    liveMessageId: null,
    chapter: null,
    battle: null,
    caveWon: false,
  };
  player.cards[CARDS[0].id] = { variants: ["metal"], active: "metal" };
  player.cards[CARDS[1].id] = { variants: ["metal", "blue"], active: "blue" };
  await ctx.repo.save(player);
}

describe("/admin summary", () => {
  it("refuses a non-owner", async () => {
    const ctx = makeCtx();
    const call = slashInteraction("stranger", {}, "owner");
    await adminCommand.execute(call as never, ctx);
    expect(lastPayload(call.reply).content).toMatch(/Only the bot owner/);
    expect(
      ctx.log.entries.find((e) => e.type === "admin_summary"),
    ).toBeUndefined();
  });

  it("lists every seeded player with their node and card count", async () => {
    const ctx = makeCtx();
    await seedPlayer(ctx, "alice", "greeting");
    await seedPlayer(ctx, "bob", "ask_name");

    const call = slashInteraction("owner", {}, "owner");
    await adminCommand.execute(call as never, ctx);
    const embed = embedOf(lastPayload(call.reply));
    expect(embed.description).toContain("<@alice>");
    expect(embed.description).toContain("greeting");
    expect(embed.description).toContain("owns 2 cards");
    expect(embed.footer.text).toContain("2 players");
    expect(
      ctx.log.entries.find((e) => e.type === "admin_summary")?.data,
    ).toMatchObject({ by: "owner" });
  });

  it("shows one player's story details", async () => {
    const ctx = makeCtx();
    await seedPlayer(ctx, "alice", "greeting");
    const call = slashInteraction("owner", { user: "alice" }, "owner");
    await adminCommand.execute(call as never, ctx);
    const embed = embedOf(lastPayload(call.reply));
    const fields = embed.fields as { name: string; value: string }[];
    expect(fields.find((f) => f.name === "Scene")?.value).toBe("greeting");
    expect(fields.find((f) => f.name === "Name")?.value).toBe("Ocean Eyes");
    expect(fields.find((f) => f.name === "Name attempts")?.value).toContain(
      "ocean",
    );
    expect(
      ctx.log.entries.find((e) => e.type === "admin_summary")?.data,
    ).toMatchObject({ by: "owner", target: "alice" });
  });

  it("says a fresh user hasn't started the story", async () => {
    const ctx = makeCtx();
    const call = slashInteraction("owner", { user: "nobody" }, "owner");
    await adminCommand.execute(call as never, ctx);
    const embed = embedOf(lastPayload(call.reply));
    expect(embed.description).toMatch(/hasn't started/);
  });
});

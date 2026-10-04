import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dailyCommand } from "../src/discord/commands/daily";
import { storyCommand } from "../src/discord/commands/story";
import { createImageRenderer } from "../src/render/renderer";
import {
  buttonInteraction,
  buttonWithModal,
  embedOf,
  lastPayload,
  makeCtx,
  modalInteraction,
  rows,
  slashInteraction,
} from "./discord-helpers";

type Ctx = ReturnType<typeof makeCtx>;

const open = async (
  ctx: Ctx,
  userId = "u",
  options: Record<string, string | boolean | null> = {},
  ownerId = userId,
) => {
  const call = slashInteraction(userId, options, ownerId);
  await storyCommand.execute(call as never, ctx);
  return lastPayload(call.reply);
};
const buttons = (payload: any): any[] =>
  rows(payload).flatMap((r) => r.components);
const labels = (payload: any) => buttons(payload).map((b) => b.label);

/** Presses the button whose label matches. Returns the update that came back. */
async function click(ctx: Ctx, payload: any, label: string, userId = "u") {
  const button = buttons(payload).find((b) => b.label === label);
  if (!button)
    throw new Error(
      `No button "${label}" among: ${labels(payload).join(", ")}`,
    );
  const interaction = buttonInteraction(userId, button.custom_id);
  await storyCommand.component!(interaction as never, ctx);
  return lastPayload(interaction.update);
}

async function submitName(ctx: Ctx, payload: any, text: string, userId = "u") {
  const input = buttons(payload).find((b) => b.custom_id.endsWith(":input"));
  const press = buttonWithModal(userId, input.custom_id);
  await storyCommand.component!(press as never, ctx);
  const modal = press.showModal.mock.calls[0][0] as any;
  const submit = modalInteraction(userId, modal.toJSON().custom_id, text);
  await storyCommand.modal!(submit as never, ctx);
  return { modal: modal.toJSON(), update: lastPayload(submit.update), submit };
}

const text = (payload: any) => embedOf(payload).description as string;

describe("/story", () => {
  it("begins at the greeting for a new player, privately, with two choices", async () => {
    const ctx = makeCtx();
    const payload = await open(ctx);
    expect(payload.flags).toBeDefined();
    expect(embedOf(payload).title).toBe("The Road");
    expect(text(payload)).toMatch(/are you one of The Eyes\?/);
    expect(labels(payload)).toEqual([
      "Yes, I am one of The Eyes",
      "No, I am not",
    ]);
    expect(ctx.repo.get("u").story).toMatchObject({ node: "greeting" });
    expect(
      ctx.log.entries.some(
        (e) =>
          e.type === "story_event" &&
          e.data.type === "node" &&
          e.data.node === "greeting",
      ),
    ).toBe(true);
  });

  it("continues where the player left off", async () => {
    const ctx = makeCtx();
    const first = await open(ctx);
    await click(ctx, first, "No, I am not");
    const again = await open(ctx);
    expect(text(again)).toMatch(/No matter/);
    expect(labels(again)).toEqual(["Continue"]);
  });

  it("asks for a name in a form that explains Eyes is added, and welcomes a name from the list", async () => {
    const ctx = makeCtx();
    const greeting = await open(ctx);
    const ask = await click(ctx, greeting, "Yes, I am one of The Eyes");
    expect(labels(ask)).toEqual(["Say my name"]);

    const { modal, update } = await submitName(ctx, ask, "abyss");
    expect(modal.custom_id).toBe("story:ask_name:text");
    expect(modal.title).toBe("Say your name");
    expect(modal.components[0].components[0]).toMatchObject({
      label: "Your name (Eyes is added for you)",
      placeholder: "Ocean",
      min_length: 1,
      max_length: 40,
      required: true,
    });
    expect(text(update)).toMatch(/Abyss Eyes\. Yes/);
    expect(ctx.repo.get("u").story).toMatchObject({
      name: "Abyss Eyes",
      isEye: true,
    });
    const kinds = ctx.log.entries
      .filter((e) => e.type === "story_event")
      .map((e) => e.data.type);
    expect(kinds).toEqual(expect.arrayContaining(["name_attempt", "name_set"]));
  });

  it("asks again when the name is not in the list, offering the closest one, and remembers every attempt", async () => {
    const ctx = makeCtx();
    const ask = await click(ctx, await open(ctx), "Yes, I am one of The Eyes");
    const { update: confirm } = await submitName(ctx, ask, "abiss");
    expect(text(confirm)).toMatch(/I find no “Abiss Eyes”/);
    expect(text(confirm)).toMatch(/Could your name be Abyss Eyes\?/);
    expect(labels(confirm)).toEqual([
      "Yes, I am Abyss Eyes",
      "I will say it again",
      "Yes, I am Abiss Eyes",
    ]);

    const again = await click(ctx, confirm, "I will say it again");
    expect(text(again)).toMatch(/Say it again, then/);
    const { update: confirm2 } = await submitName(ctx, again, "Zzzzzzzz");
    expect(text(confirm2)).toMatch(/Nor anything close to it/);
    expect(labels(confirm2)).toEqual([
      "I will say it again",
      "Yes, I am Zzzzzzzz Eyes",
    ]);

    const kept = await click(ctx, confirm2, "Yes, I am Zzzzzzzz Eyes");
    expect(text(kept)).toMatch(/Very well, Zzzzzzzz Eyes/);
    expect(ctx.repo.get("u").story).toMatchObject({
      name: "Zzzzzzzz Eyes",
      nameAttempts: [
        { typed: "Abiss Eyes", result: "near", suggestion: "Abyss Eyes" },
        { typed: "Zzzzzzzz Eyes", result: "none" },
      ],
    });
  });

  it("does not let a name carry formatting, mentions or links into the story text", async () => {
    const ctx = makeCtx();
    const ask = await click(ctx, await open(ctx), "Yes, I am one of The Eyes");
    const { update } = await submitName(
      ctx,
      ask,
      "**Bold** @everyone <@123> [x](http://evil)",
    );
    // Only the plain letters survive; the speaker label is hidden, so no formatting leaks in.
    expect(text(update)).toContain("Bold Everyone 123 Xhttpevil Eyes");
    expect(text(update)).not.toMatch(/[@<>\[\]]|:\/\//);
  });

  it("refuses an empty name and stays on the question", async () => {
    const ctx = makeCtx();
    const ask = await click(ctx, await open(ctx), "Yes, I am one of The Eyes");
    const { update } = await submitName(ctx, ask, "  Eyes  ");
    expect(text(update)).toMatch(/cannot be empty/);
    expect(labels(update)).toEqual(["Say my name"]);
    expect(ctx.repo.get("u").story!.nameAttempts).toEqual([]);
  });

  it("an old message never changes the story: it just shows where the player really is", async () => {
    const ctx = makeCtx();
    const greeting = await open(ctx);
    await click(ctx, greeting, "No, I am not"); // moves to not_eye
    const stale = await click(ctx, greeting, "Yes, I am one of The Eyes"); // the old greeting message
    expect(text(stale)).toMatch(/No matter/); // resynced to the current scene
    expect(ctx.repo.get("u").story).toMatchObject({
      node: "not_eye",
      isEye: false,
    });
  });

  it("a form submitted after the player moved on resyncs instead of acting", async () => {
    const ctx = makeCtx();
    const ask = await click(ctx, await open(ctx), "Yes, I am one of The Eyes");
    const input = buttons(ask).find((b) => b.custom_id.endsWith(":input"));
    const press = buttonWithModal("u", input.custom_id);
    await storyCommand.component!(press as never, ctx);
    // meanwhile the player answers from another window
    await submitName(ctx, ask, "abyss");
    const late = modalInteraction("u", "story:ask_name:text", "something else");
    await storyCommand.modal!(late as never, ctx);
    expect(ctx.repo.get("u").story!.name).toBe("Abyss Eyes"); // unchanged
    expect(lastPayload(late.update).embeds).toBeDefined();
  });

  it("works for a player who says they are not one of The Eyes, all the way to the map and the book", async () => {
    const ctx = makeCtx(4);
    let p = await click(ctx, await open(ctx), "No, I am not");
    p = await click(ctx, p, "Continue");
    expect(text(p)).toMatch(/Do you know where they live\?/);
    expect(text(p)).toContain("Bò Tuôi");
    p = await click(ctx, p, "No, I do not");
    expect(text(p)).toMatch(/search together/);
    p = await click(ctx, p, "Continue");
    expect(text(p)).toMatch(/strange curse/);
    p = await click(ctx, p, "Continue");
    expect(embedOf(p).title).toBe("The Crossroads");
    p = await click(ctx, p, "Look at the map");
    expect(embedOf(p).fields.find((f: any) => f.name === "Map").value).toBe(
      "○ The Eyes Of Wisdom  ──  ● The Crossroads (you are here)  ──  ○ Bò Tuôi",
    );
    expect(labels(p)).toEqual(["The Eyes Of Wisdom", "Bò Tuôi"]);

    p = await click(ctx, p, "Bò Tuôi");
    expect(text(p)).toMatch(/Not yet/);
    p = await click(ctx, p, "Back to the map");
    p = await click(ctx, p, "The Eyes Of Wisdom");
    expect(embedOf(p).title).toBe("The Eyes Of Wisdom");
    expect(text(p)).toMatch(/there is a book/);
    expect(labels(p)).toEqual([
      "How do you know all this?",
      "Just open the book",
    ]);

    // asking how he knows gets an evasive answer: just call him "Stranger Eyes"
    const asked = await click(ctx, p, "How do you know all this?");
    expect(text(asked)).toContain("Stranger Eyes");
    expect(labels(asked)).toEqual(["Open the book"]);
    p = await click(ctx, asked, "Open the book");

    // the book: twelve cards listed as text, in the 2-2-8 mix, and nothing granted yet
    const cardsText = embedOf(p).fields.find((f: any) => f.name === "The cards")
      .value as string;
    expect(cardsText.split("\n")).toHaveLength(12);
    expect(cardsText.match(/epic/g)).toHaveLength(2);
    expect(cardsText.match(/rare/g)).toHaveLength(2);
    expect(cardsText.match(/common/g)).toHaveLength(8);
    expect(labels(p)).toEqual([
      "Take these cards",
      "Close the book and open it again",
    ]);
    expect(embedOf(p).footer.text).toBe("Opened 1 time");
    expect(ctx.repo.get("u").cards).toEqual({});

    // closing the book and opening it again shows twelve different cards
    const again = await click(ctx, p, "Close the book and open it again");
    expect(
      embedOf(again).fields.find((f: any) => f.name === "The cards").value,
    ).not.toBe(cardsText);
    // the label is hidden now; the stranger's reroll reaction shows as plain text
    expect(text(again)).toMatch(/Wrong way/);
    expect(embedOf(again).footer.text).toBe("Opened 2 times");

    // before taking them, /daily is locked
    const locked = slashInteraction("u");
    await dailyCommand.execute(locked as never, ctx);
    expect(lastPayload(locked.reply).content).toMatch(/\/story/);

    // taking them grants all twelve, makes them the deck and opens /daily
    const taken = await click(ctx, again, "Take these cards");
    expect(text(taken)).toMatch(/settle into your hands/);
    const player = ctx.repo.get("u");
    expect(Object.keys(player.cards)).toHaveLength(12);
    expect(player.deck).toHaveLength(12);
    expect(player.story!.starterClaimed).toBe(true);
    expect(
      ctx.log.entries.some(
        (e) => e.type === "story_event" && e.data.type === "pack_taken",
      ),
    ).toBe(true);

    const end = await click(ctx, taken, "Continue");
    expect(text(end)).toMatch(/The story continues soon/);
    expect(buttons(end)).toEqual([]);

    const daily = slashInteraction("u");
    await dailyCommand.execute(daily as never, ctx);
    expect(embedOf(lastPayload(daily.reply)).title).toBe("🎁 Daily pack");
  });

  it("an Eye who does not know the way is asked to point it out", async () => {
    const ctx = makeCtx();
    let p = await click(ctx, await open(ctx), "Yes, I am one of The Eyes");
    ({ update: p } = await submitName(ctx, p, "abyss"));
    p = await click(ctx, p, "Continue");
    p = await click(ctx, p, "No, I do not");
    expect(text(p)).toMatch(/you are one of The Eyes\. Surely you know/);
    expect(labels(p)).toEqual(["Point the way"]);
  });

  it("with images on, the map and the book are attached and replace the previous image", async () => {
    const ctx = makeCtx(
      4,
      await createImageRenderer({ assetsDir: join(__dirname, "..", "assets") }),
    );
    let p = await click(ctx, await open(ctx), "No, I am not");
    for (const label of ["Continue", "No, I do not", "Continue", "Continue"])
      p = await click(ctx, p, label);
    p = await click(ctx, p, "Look at the map");
    expect(p.files).toHaveLength(1);
    expect(p.attachments).toEqual([]);
    expect(embedOf(p).fields ?? []).toHaveLength(0); // no text copy of the map
    p = await click(ctx, p, "The Eyes Of Wisdom");
    expect(p.files).toHaveLength(0); // a scene without an image drops the old one
    p = await click(ctx, p, "Just open the book");
    expect(p.files).toHaveLength(1);
    expect(
      (embedOf(p).fields ?? []).find((f: any) => f.name === "The cards"),
    ).toBeUndefined();
  });

  it("tells a player with no story to begin one when they press an old button", async () => {
    const ctx = makeCtx();
    const press = buttonInteraction("nobody", "story:greeting:c:0");
    await storyCommand.component!(press as never, ctx);
    expect(lastPayload(press.update).content).toMatch(/\/story/);
  });

  it("a form that was not opened from the story message gets a fresh reply instead of an update", async () => {
    const ctx = makeCtx();
    await open(ctx);
    const submit = modalInteraction("u", "story:ask_name:text", "abyss", false);
    await storyCommand.modal!(submit as never, ctx);
    expect(submit.update).not.toHaveBeenCalled();
    expect(lastPayload(submit.reply).flags).toBeDefined();
  });
});

describe("/story restart", () => {
  it("only the owner can erase progress, and it starts a brand new story", async () => {
    const ctx = makeCtx();
    let p = await click(ctx, await open(ctx), "No, I am not");
    expect(ctx.repo.get("u").story!.node).toBe("not_eye");
    const player = ctx.repo.get("u");
    player.cards["abyss-eyes"] = 3;
    player.coins = 50;
    await ctx.repo.save(player);

    const refused = slashInteraction("u", { restart: true }, "someone-else");
    await storyCommand.execute(refused as never, ctx);
    expect(lastPayload(refused.reply).content).toMatch(/Only the bot owner/);
    expect(ctx.repo.get("u").story!.node).toBe("not_eye");

    p = await open(ctx, "u", { restart: true });
    expect(text(p)).toMatch(/are you one of The Eyes/);
    expect(ctx.repo.get("u")).toMatchObject({
      coins: 0,
      cards: {},
      story: { node: "greeting", name: null },
    });
    expect(ctx.log.entries.some((e) => e.type === "story_restarted")).toBe(
      true,
    );
  });
});

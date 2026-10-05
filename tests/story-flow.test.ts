import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dailyCommand } from "../src/discord/commands/daily";
import { storyCommand } from "../src/discord/commands/story";
import { createImageRenderer } from "../src/render/renderer";
import { GATE } from "../src/story/prologue";
import {
  buttonWithModal,
  dmButtonInteraction,
  dmChannel,
  embedOf,
  lastPayload,
  makeCtx,
  modalInteraction,
  rows,
  slashInteraction,
} from "./discord-helpers";

type Ctx = ReturnType<typeof makeCtx>;
type Dm = ReturnType<typeof dmChannel>;

const buttons = (payload: any): any[] =>
  rows(payload).flatMap((r) => r.components);
const labels = (payload: any) => buttons(payload).map((b) => b.label);
const content = (payload: any): string => payload.content as string;
const text = (payload: any) => embedOf(payload).description as string;

/** The latest DM message that still carries buttons — the one the player is meant to act on. */
const live = (dm: Dm): any =>
  [...dm.sent].reverse().find((p) => buttons(p).length > 0);

/** Runs /story (or /invite-style resume) and returns the DM channel plus the gate message it sent. */
async function openGate(
  ctx: Ctx,
  userId = "u",
  options: Record<string, string | boolean | null> = {},
  ownerId = userId,
) {
  const call = slashInteraction(userId, options, ownerId);
  await storyCommand.execute(call as never, ctx);
  return { call, dm: call.dm as Dm, gate: (call.dm as Dm).sent.at(-1) };
}

/** Presses a gate button (begin / resume / decline). */
async function pressGate(ctx: Ctx, dm: Dm, label: string, userId = "u") {
  const gate = dm.sent.at(-1);
  const button = buttons(gate).find((b: any) => b.label === label);
  if (!button)
    throw new Error(
      `No gate button "${label}" among: ${labels(gate).join(", ")}`,
    );
  const press = dmButtonInteraction(userId, button.custom_id, "gate-msg", dm);
  await storyCommand.component!(press as never, ctx);
  return press;
}

/** Opens /story for a brand-new player and begins the story, returning the live greeting message. */
async function begin(
  ctx: Ctx,
  userId = "u",
  options: Record<string, string | boolean | null> = {},
  ownerId = userId,
) {
  const { dm } = await openGate(ctx, userId, options, ownerId);
  await pressGate(ctx, dm, GATE.readyYes, userId);
  return { dm, payload: live(dm) };
}

/** Presses the live button whose label matches, then returns the new live message. */
async function click(ctx: Ctx, dm: Dm, label: string, userId = "u") {
  const payload = live(dm);
  const button = buttons(payload).find((b: any) => b.label === label);
  if (!button)
    throw new Error(
      `No button "${label}" among: ${labels(payload).join(", ")}`,
    );
  const liveId = ctx.repo.get(userId).story!.liveMessageId!;
  const press = dmButtonInteraction(userId, button.custom_id, liveId, dm);
  await storyCommand.component!(press as never, ctx);
  return { press, payload: live(dm) };
}

async function submitName(ctx: Ctx, dm: Dm, textValue: string, userId = "u") {
  const payload = live(dm);
  const input = buttons(payload).find((b: any) =>
    b.custom_id.endsWith(":input"),
  );
  const liveId = ctx.repo.get(userId).story!.liveMessageId!;
  const press = {
    ...buttonWithModal(userId, input.custom_id),
    message: { id: liveId },
    channel: dm,
  };
  await storyCommand.component!(press as never, ctx);
  const modal = press.showModal.mock.calls[0][0] as any;
  const submit = {
    ...modalInteraction(userId, modal.toJSON().custom_id, textValue),
    message: { id: liveId },
    channel: dm,
  };
  await storyCommand.modal!(submit as never, ctx);
  return { modal: modal.toJSON(), payload: live(dm), submit };
}

describe("/story gate and DM delivery", () => {
  it("sends an ephemeral pointer and asks the ready-gate in the DM for a new player", async () => {
    const ctx = makeCtx();
    const { call, dm, gate } = await openGate(ctx);
    expect(lastPayload(call.reply as any).flags).toBeDefined();
    expect(lastPayload(call.reply as any).content).toMatch(/DM/);
    expect(content(gate)).toBe(GATE.readyLine);
    expect(labels(gate)).toEqual([GATE.readyYes, GATE.readyNo]);
    // Nothing persisted before the player agrees.
    expect(ctx.repo.get("u").story).toBeNull();
    expect(dm.sent).toHaveLength(1);
  });

  it("begins the greeting as plain DM text once the player agrees", async () => {
    const ctx = makeCtx();
    const { dm, payload } = await begin(ctx);
    expect(payload.embeds).toBeUndefined();
    expect(content(payload)).toMatch(/are you one of The Eyes\?/);
    expect(labels(payload)).toEqual([
      "Yes, I am one of The Eyes",
      "No, I am not",
    ]);
    expect(ctx.repo.get("u").story).toMatchObject({ node: "greeting" });
    // The greeting has two lines, so after the gate there are two more messages.
    expect(
      dm.sent.filter((p) => content(p) !== undefined).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("a plain scene sends one message per line, with buttons only on the last", async () => {
    const ctx = makeCtx();
    const { dm } = await begin(ctx);
    // The greeting (2 lines) was sent after the gate message.
    const sceneMsgs = dm.sent.slice(1);
    expect(sceneMsgs).toHaveLength(2);
    expect(buttons(sceneMsgs[0])).toHaveLength(0);
    expect(buttons(sceneMsgs[1])).toHaveLength(2);
  });
});

describe("/story", () => {
  it("continues where the player left off via the resume gate", async () => {
    const ctx = makeCtx();
    const { dm } = await begin(ctx);
    await click(ctx, dm, "No, I am not"); // moves to not_eye
    // A second /story offers the resume gate.
    const second = await openGate(ctx);
    expect(content(second.gate)).toBe(GATE.resumeLine);
    expect(labels(second.gate)).toEqual([GATE.resumeYes, GATE.resumeNo]);
    await pressGate(ctx, second.dm, GATE.resumeYes);
    const resumed = live(second.dm);
    expect(content(resumed)).toMatch(/No matter/);
    expect(labels(resumed)).toEqual(["Continue"]);
  });

  it("asks for a name in a form that explains Eyes is added, and welcomes a name from the list", async () => {
    const ctx = makeCtx();
    const { dm } = await begin(ctx);
    const { payload: ask } = await click(ctx, dm, "Yes, I am one of The Eyes");
    expect(labels(ask)).toEqual(["Say my name"]);

    const { modal, payload: update } = await submitName(ctx, dm, "abyss");
    expect(modal.custom_id).toBe("story:ask_name:text");
    expect(modal.title).toBe("Say your name");
    expect(modal.components[0].components[0]).toMatchObject({
      label: "Your name (Eyes is added for you)",
      placeholder: "Ocean",
      min_length: 1,
      max_length: 40,
      required: true,
    });
    expect(content(update)).toMatch(/Abyss Eyes\. Yes/);
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
    const { dm } = await begin(ctx);
    await click(ctx, dm, "Yes, I am one of The Eyes");
    const { payload: confirm } = await submitName(ctx, dm, "abiss");
    expect(
      dm.sent.some((p) => content(p)?.match(/Could your name be Abyss Eyes\?/)),
    ).toBe(true);
    expect(labels(confirm)).toEqual([
      "Yes, I am Abyss Eyes",
      "I will say it again",
      "Yes, I am Abiss Eyes",
    ]);
    // One of the earlier scene lines carried the "I find no" line.
    expect(
      dm.sent.some((p) => content(p)?.match(/I find no “Abiss Eyes”/)),
    ).toBe(true);

    await click(ctx, dm, "I will say it again");
    expect(dm.sent.some((p) => content(p)?.match(/Say it again, then/))).toBe(
      true,
    );
    const { payload: confirm2 } = await submitName(ctx, dm, "Zzzzzzzz");
    expect(
      dm.sent.some((p) => content(p)?.match(/Nor anything close to it/)),
    ).toBe(true);
    expect(labels(confirm2)).toEqual([
      "I will say it again",
      "Yes, I am Zzzzzzzz Eyes",
    ]);

    const { payload: kept } = await click(ctx, dm, "Yes, I am Zzzzzzzz Eyes");
    expect(content(kept)).toMatch(/Very well, Zzzzzzzz Eyes/);
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
    const { dm } = await begin(ctx);
    await click(ctx, dm, "Yes, I am one of The Eyes");
    const { payload: update } = await submitName(
      ctx,
      dm,
      "**Bold** @everyone <@123> [x](http://evil)",
    );
    // The sanitized name appears in one of the delivered lines; no formatting/mentions leak in.
    expect(
      dm.sent.some((p) =>
        content(p)?.includes("Bold Everyone 123 Xhttpevil Eyes"),
      ),
    ).toBe(true);
    expect(
      dm.sent.every(
        (p) => content(p) === undefined || !/[@<>\[\]]|:\/\//.test(content(p)),
      ),
    ).toBe(true);
    expect(update.allowedMentions).toEqual({ parse: [] });
  });

  it("refuses an empty name and stays on the question", async () => {
    const ctx = makeCtx();
    const { dm } = await begin(ctx);
    await click(ctx, dm, "Yes, I am one of The Eyes");
    const { payload: update } = await submitName(ctx, dm, "  Eyes  ");
    expect(dm.sent.some((p) => content(p)?.match(/cannot be empty/))).toBe(
      true,
    );
    expect(labels(update)).toEqual(["Say my name"]);
    expect(ctx.repo.get("u").story!.nameAttempts).toEqual([]);
  });

  it("a button pressed on an old (non-live) message strips its buttons and does not advance", async () => {
    const ctx = makeCtx();
    const { dm } = await begin(ctx);
    const greeting = live(dm);
    const greetingBtn = buttons(greeting).find(
      (b: any) => b.label === "Yes, I am one of The Eyes",
    );
    const greetingMsgId = ctx.repo.get("u").story!.liveMessageId!;
    // advance via a different choice first so the greeting message is no longer live
    await click(ctx, dm, "No, I am not"); // -> not_eye
    expect(ctx.repo.get("u").story!.node).toBe("not_eye");
    // now press the stale greeting button
    const stale = dmButtonInteraction(
      "u",
      greetingBtn.custom_id,
      greetingMsgId,
      dm,
    );
    await storyCommand.component!(stale as never, ctx);
    expect(stale.update).toHaveBeenCalledWith({ components: [] });
    expect(ctx.repo.get("u").story).toMatchObject({
      node: "not_eye",
      isEye: false,
    });
  });

  it("a double-click on the same live message does not repeat a step", async () => {
    const ctx = makeCtx();
    const { dm } = await begin(ctx);
    const payload = live(dm);
    const button = buttons(payload).find(
      (b: any) => b.label === "No, I am not",
    );
    const liveId = ctx.repo.get("u").story!.liveMessageId!;
    const first = dmButtonInteraction("u", button.custom_id, liveId, dm);
    await storyCommand.component!(first as never, ctx);
    expect(ctx.repo.get("u").story!.node).toBe("not_eye");
    const beforeSecond = dm.sent.length;
    // second click on the same (now stale) message
    const second = dmButtonInteraction("u", button.custom_id, liveId, dm);
    await storyCommand.component!(second as never, ctx);
    expect(ctx.repo.get("u").story!.node).toBe("not_eye");
    expect(dm.sent.length).toBe(beforeSecond); // nothing new sent
  });

  it("works for a player who says they are not one of The Eyes, all the way to the map and the book", async () => {
    const ctx = makeCtx(4);
    const { dm } = await begin(ctx);
    await click(ctx, dm, "No, I am not");
    let p = (await click(ctx, dm, "Continue")).payload;
    expect(content(p)).toMatch(/Do you know where they live\?/);
    expect(dm.sent.some((m) => content(m)?.includes("Bò Tuôi"))).toBe(true);
    p = (await click(ctx, dm, "No, I do not")).payload;
    expect(content(p)).toMatch(/search together/);
    p = (await click(ctx, dm, "Continue")).payload;
    expect(dm.sent.some((m) => content(m)?.match(/strange curse/))).toBe(true);
    p = (await click(ctx, dm, "Continue")).payload;
    // The crossroads informant scene is still plain text.
    expect(content(p)).toMatch(/take me to The Eyes Of Wisdom/);
    // Looking at the map is a RICH scene (embed).
    p = (await click(ctx, dm, "Look at the map")).payload;
    expect(embedOf(p).title).toBe("The Crossroads");
    expect(embedOf(p).fields.find((f: any) => f.name === "Map").value).toBe(
      "○ The Eyes Of Wisdom  ──  ● The Crossroads (you are here)  ──  ○ Bò Tuôi",
    );
    expect(labels(p)).toEqual(["The Eyes Of Wisdom", "Bò Tuôi"]);

    p = (await click(ctx, dm, "Bò Tuôi")).payload;
    // map_not_yet is a plain conversation scene.
    expect(content(p)).toMatch(/Not yet/);
    p = (await click(ctx, dm, "Back to the map")).payload;
    p = (await click(ctx, dm, "The Eyes Of Wisdom")).payload;
    // wisdom is a plain conversation scene again
    expect(content(p)).toMatch(/there is a book/);
    expect(labels(p)).toEqual([
      "How do you know all this?",
      "Just open the book",
    ]);

    const asked = (await click(ctx, dm, "How do you know all this?")).payload;
    expect(dm.sent.some((m) => content(m)?.includes("Stranger Eyes"))).toBe(
      true,
    );
    expect(labels(asked)).toEqual(["Open the book"]);
    p = (await click(ctx, dm, "Open the book")).payload;

    // the book is a RICH scene (embed) with the twelve cards listed
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

    const again = (await click(ctx, dm, "Close the book and open it again"))
      .payload;
    expect(
      embedOf(again).fields.find((f: any) => f.name === "The cards").value,
    ).not.toBe(cardsText);
    expect(embedOf(again).description).toMatch(/Wrong way/);
    expect(embedOf(again).footer.text).toBe("Opened 2 times");

    // before taking them, /daily is locked
    const locked = slashInteraction("u");
    await dailyCommand.execute(locked as never, ctx);
    expect(lastPayload(locked.reply as any).content).toMatch(/\/story/);

    await click(ctx, dm, "Take these cards");
    expect(
      dm.sent.some((p) => content(p)?.match(/settle into your hands/)),
    ).toBe(true);
    const player = ctx.repo.get("u");
    expect(Object.keys(player.cards)).toHaveLength(12);
    expect(player.deck).toHaveLength(12);
    expect(player.story!.starterClaimed).toBe(true);
    expect(
      ctx.log.entries.some(
        (e) => e.type === "story_event" && e.data.type === "pack_taken",
      ),
    ).toBe(true);

    await click(ctx, dm, "Continue");
    // the terminal scene has no buttons; its text lands and the player ends at prologue_end
    expect(
      dm.sent.some((m) => content(m)?.match(/The story continues soon/)),
    ).toBe(true);
    expect(ctx.repo.get("u").story!.node).toBe("prologue_end");

    const daily = slashInteraction("u");
    await dailyCommand.execute(daily as never, ctx);
    expect(embedOf(lastPayload(daily.reply as any)).title).toBe(
      "🎁 Daily pack",
    );
  });

  it("an Eye who does not know the way is asked to point it out", async () => {
    const ctx = makeCtx();
    const { dm } = await begin(ctx);
    await click(ctx, dm, "Yes, I am one of The Eyes");
    await submitName(ctx, dm, "abyss");
    await click(ctx, dm, "Continue");
    const { payload: p } = await click(ctx, dm, "No, I do not");
    expect(
      dm.sent.some((m) =>
        content(m)?.match(/you are one of The Eyes\. Surely you know/),
      ),
    ).toBe(true);
    expect(labels(p)).toEqual(["Point the way"]);
  });

  it("with images on, the map and the book are attached and the plain scenes carry no image", async () => {
    const ctx = makeCtx(
      4,
      await createImageRenderer({ assetsDir: join(__dirname, "..", "assets") }),
    );
    const { dm } = await begin(ctx);
    await click(ctx, dm, "No, I am not");
    for (const label of ["Continue", "No, I do not", "Continue", "Continue"])
      await click(ctx, dm, label);
    let p = (await click(ctx, dm, "Look at the map")).payload;
    expect(p.files).toHaveLength(1);
    expect(embedOf(p).fields ?? []).toHaveLength(0); // no text copy of the map
    p = (await click(ctx, dm, "The Eyes Of Wisdom")).payload;
    expect(p.embeds).toBeUndefined(); // a plain scene has no image/embed
    p = (await click(ctx, dm, "Just open the book")).payload;
    expect(p.files).toHaveLength(1);
    expect(
      (embedOf(p).fields ?? []).find((f: any) => f.name === "The cards"),
    ).toBeUndefined();
  });

  it("tells a player with no story to begin one when they press an old button", async () => {
    const ctx = makeCtx();
    const press = dmButtonInteraction("nobody", "story:greeting:c:0", "msg-x");
    await storyCommand.component!(press as never, ctx);
    expect(lastPayload(press.update as any).content).toMatch(/\/story/);
  });

  it("replies with the closed-DM error when the player's DMs are shut", async () => {
    const ctx = makeCtx();
    const call = slashInteraction("u", {}, "u", { dm: null });
    await storyCommand.execute(call as never, ctx);
    expect(lastPayload(call.reply as any).content).toMatch(
      /couldn't message you/,
    );
    expect(ctx.repo.get("u").story).toBeNull();
  });
});

describe("/story gate persistence", () => {
  it("a new player sees the ready-gate and declining persists nothing", async () => {
    const ctx = makeCtx();
    const { dm } = await openGate(ctx);
    const press = await pressGate(ctx, dm, GATE.readyNo);
    expect(press.update).toHaveBeenCalledWith({ components: [] });
    expect(dm.sent.some((p) => content(p) === GATE.declineLine)).toBe(true);
    expect(ctx.repo.get("u").story).toBeNull();

    // a second /story re-asks the ready-gate from scratch
    const second = await openGate(ctx);
    expect(content(second.gate)).toBe(GATE.readyLine);
  });

  it("beginning the gate creates the story and delivers the greeting", async () => {
    const ctx = makeCtx();
    const { dm } = await openGate(ctx);
    await pressGate(ctx, dm, GATE.readyYes);
    expect(ctx.repo.get("u").story).toMatchObject({ node: "greeting" });
    expect(content(live(dm))).toMatch(/are you one of The Eyes\?/);
  });

  it("a player with progress sees the resume gate and resume lands at the saved node", async () => {
    const ctx = makeCtx();
    const { dm } = await begin(ctx);
    await click(ctx, dm, "No, I am not"); // not_eye
    const node = ctx.repo.get("u").story!.node;
    const second = await openGate(ctx);
    expect(content(second.gate)).toBe(GATE.resumeLine);
    await pressGate(ctx, second.dm, GATE.resumeYes);
    expect(ctx.repo.get("u").story!.node).toBe(node);
    expect(content(live(second.dm))).toMatch(/No matter/);
  });

  it("declining a resume leaves saved progress unchanged", async () => {
    const ctx = makeCtx();
    const { dm } = await begin(ctx);
    await click(ctx, dm, "No, I am not");
    const before = ctx.repo.get("u").story;
    const second = await openGate(ctx);
    const press = await pressGate(ctx, second.dm, GATE.resumeNo);
    expect(press.update).toHaveBeenCalledWith({ components: [] });
    expect(
      second.dm.sent.some((p) => content(p) === GATE.resumeDeclineLine),
    ).toBe(true);
    expect(ctx.repo.get("u").story).toEqual(before);
  });
});

describe("/story restart", () => {
  it("only the owner can erase progress, and it starts a brand new story", async () => {
    const ctx = makeCtx();
    const { dm } = await begin(ctx);
    await click(ctx, dm, "No, I am not");
    expect(ctx.repo.get("u").story!.node).toBe("not_eye");
    const player = ctx.repo.get("u");
    player.cards["abyss-eyes"] = 3;
    player.coins = 50;
    await ctx.repo.save(player);

    const refused = slashInteraction("u", { restart: true }, "someone-else");
    await storyCommand.execute(refused as never, ctx);
    expect(lastPayload(refused.reply as any).content).toMatch(
      /Only the bot owner/,
    );
    expect(ctx.repo.get("u").story!.node).toBe("not_eye");

    // owner restart wipes progress; the gate shown is then the ready-gate again
    const restart = await openGate(ctx, "u", { restart: true });
    expect(ctx.repo.get("u")).toMatchObject({
      coins: 0,
      cards: {},
      story: null,
    });
    expect(content(restart.gate)).toBe(GATE.readyLine);
    await pressGate(ctx, restart.dm, GATE.readyYes);
    expect(content(live(restart.dm))).toMatch(/are you one of The Eyes/);
    expect(ctx.repo.get("u").story).toMatchObject({
      node: "greeting",
      name: null,
    });
    expect(ctx.log.entries.some((e) => e.type === "story_restarted")).toBe(
      true,
    );
  });
});

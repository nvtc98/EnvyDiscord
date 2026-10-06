import { beforeEach, describe, expect, it } from "vitest";
import { battleCommand } from "../src/discord/commands/battle";
import { setBattleStepDelay } from "../src/discord/battle-session";
import { createImageRenderer } from "../src/render/renderer";
import {
  buttonInteraction,
  embedOf,
  lastPayload,
  makeCtx,
  ownEverything,
  rows,
  selectInteraction,
  slashInteraction,
} from "./discord-helpers";
import { join } from "node:path";

type Ctx = ReturnType<typeof makeCtx>;

/** Starts a battle and returns what the player sees plus handles to press its controls. */
async function start(
  ctx: Ctx,
  userId = "u1",
  difficulty: string | null = "normal",
) {
  const interaction = slashInteraction(userId, { difficulty });
  await battleCommand.execute(interaction as never, ctx);
  const payload = interaction.reply.mock.calls[0][0] as any;
  return { payload, id: customIdOf(payload).split(":")[1] };
}

const customIdOf = (payload: any): string =>
  rows(payload)[2].components[0].custom_id;

async function press(
  ctx: Ctx,
  userId: string,
  id: string,
  kind: string,
  arg?: string,
) {
  const interaction = buttonInteraction(
    userId,
    `battle:${id}:${kind}${arg !== undefined ? `:${arg}` : ""}`,
  );
  await battleCommand.component!(interaction as never, ctx);
  return interaction;
}

/**
 * The frame the player ends up on after a press. The animated end-of-turn path finishes with
 * `editReply`; the instant paths (lane, forfeit, stale) finish with `update`. This reads whichever
 * one was called last.
 */
function finalFrame(interaction: {
  update: ReturnType<typeof import("vitest").vi.fn>;
  editReply: ReturnType<typeof import("vitest").vi.fn>;
}): any {
  const edits = interaction.editReply.mock.calls;
  if (edits.length > 0) return edits.at(-1)![0];
  return lastPayload(interaction.update);
}

async function pick(ctx: Ctx, userId: string, id: string, uid: string) {
  const interaction = selectInteraction(userId, `battle:${id}:pick`, [uid]);
  await battleCommand.component!(interaction as never, ctx);
  return interaction;
}

/** An option in the card menu the player can afford right now. */
const affordable = (payload: any) =>
  rows(payload)[0].components[0].options.find(
    (o: any) => !o.description.startsWith("Beyond thy means"),
  );

/** Starts battles with successive seeds until the opening hand contains a card that can be played at once. */
async function startWithPlayableCard(userId = "u1") {
  for (let seed = 1; seed <= 60; seed++) {
    const ctx = makeCtx(seed);
    const started = await start(ctx, userId);
    if (affordable(started.payload)) return { ctx, ...started };
  }
  throw new Error("no seed gave a playable opening hand");
}

describe("/battle", () => {
  // Animated opponent-turn playback uses real timers in production; keep tests instant and timer-free.
  beforeEach(() => setBattleStepDelay(0));

  it("is for the bot owner only while the story is being built", async () => {
    const ctx = makeCtx(3);
    const stranger = slashInteraction("stranger", {}, "someone-else");
    await battleCommand.execute(stranger as never, ctx);
    expect(lastPayload(stranger.reply).content).toMatch(/\/story/);
    expect(lastPayload(stranger.reply).components).toBeUndefined();
    expect(
      ctx.log.entries.find((e) => e.type === "battle_started"),
    ).toBeUndefined();
  });

  it("starts a private battle with a hand, three control rows and a log", async () => {
    const ctx = makeCtx(3);
    const { payload } = await start(ctx);
    expect(payload.flags).toBeDefined(); // ephemeral
    const [menuRow, laneRow, actionRow] = rows(payload);
    expect(menuRow.components[0].options.length).toBeGreaterThanOrEqual(3);
    expect(laneRow.components.map((c: any) => c.label)).toEqual([
      "Left",
      "Middle",
      "Right",
    ]);
    expect(laneRow.components.every((c: any) => c.disabled)).toBe(true); // nothing selected yet
    expect(actionRow.components.map((c: any) => c.label)).toEqual([
      "End the turn",
      "Yield",
    ]);
    expect(embedOf(payload).title).toMatch(/Round 1/);
    expect(
      ctx.log.entries.find((e) => e.type === "battle_started")?.data,
    ).toMatchObject({ difficulty: "normal" });
  });

  it("tops the deck up with guest cards for a new player, and says so", async () => {
    const ctx = makeCtx(3);
    const { payload } = await start(ctx);
    expect(embedOf(payload).description).toMatch(/guest cards/i);
    expect(ctx.repo.get("u1").cards).toEqual({}); // never added to the collection
  });

  it("does not mention guests when the player owns a full deck", async () => {
    const ctx = makeCtx(3);
    ownEverything(ctx, "u1");
    expect(embedOf((await start(ctx)).payload).description ?? "").not.toMatch(
      /guest/i,
    );
  });

  it("picking a card enables the lanes it can be played in, without touching the image", async () => {
    const { ctx, payload, id } = await startWithPlayableCard();
    const option = affordable(payload);
    expect(option).toBeDefined();
    const click = await pick(ctx, "u1", id, option.value);
    const update = lastPayload(click.update);
    expect(update.embeds).toBeUndefined(); // only the controls change
    expect(update.files).toBeUndefined();
    const lanes = rows(update)[1].components;
    expect(lanes.every((c: any) => !c.disabled)).toBe(true);
    expect(
      rows(update)[0].components[0].options.find(
        (o: any) => o.value === option.value,
      ).default,
    ).toBe(true);
  });

  it("playing a card puts it on the board, removes it from the hand and reports it", async () => {
    const { ctx, payload, id } = await startWithPlayableCard();
    const option = affordable(payload);
    const handBefore = rows(payload)[0].components[0].options.length;
    await pick(ctx, "u1", id, option.value);
    const click = await press(ctx, "u1", id, "lane", "1");
    const update = lastPayload(click.update);
    expect(embedOf(update).description).toMatch(
      /You played .* in the Middle lane/,
    );
    expect(update.attachments).toEqual([]);
    const handAfter = rows(update)[0].components[0].options;
    expect(
      handAfter.length === handBefore - 1 || handAfter[0].value === "none",
    ).toBe(true);
    expect(embedOf(update).fields.map((f: any) => f.name)).toContain(
      "The field",
    ); // text mode
    expect(
      ctx.log.entries.some(
        (e) => e.type === "battle_event" && e.data.type === "played",
      ),
    ).toBe(true);
  });

  it("refuses a lane press with no card picked", async () => {
    const ctx = makeCtx(3);
    const { id } = await start(ctx);
    const click = await press(ctx, "u1", id, "lane", "0");
    expect(click.update).not.toHaveBeenCalled();
    expect(lastPayload(click.reply).content).toMatch(/canst not play/i);
  });

  it("ending the turn lets the AI answer, resolves the round and returns control to the player", async () => {
    const ctx = makeCtx(5);
    const { payload, id } = await start(ctx);
    const click = await press(ctx, "u1", id, "end");
    // Controls vanish while the opponent acts (the acknowledge frame).
    expect(lastPayload(click.update).components).toEqual([]);
    const update = finalFrame(click);
    expect(embedOf(update).title).toMatch(/Round 2 · Thy turn/);
    expect(embedOf(update).description).toMatch(/Round 1 ends/);
    expect(rows(update)[2].components.every((c: any) => !c.disabled)).toBe(
      true,
    );
    expect(rows(payload)).toHaveLength(3);
  });

  it("plays through a whole game by only ending turns, then records the result and cleans up", async () => {
    const ctx = makeCtx(8);
    const { id } = await start(ctx, "u9", "hard");
    let last: any;
    for (let i = 0; i < 80; i++) {
      const click = await press(ctx, "u9", id, "end");
      last = finalFrame(click);
      if (last.components.length === 0) break; // the end screen has no controls
    }
    expect(embedOf(last).title).toMatch(/Defeat|Victory|Draw/);
    const player = ctx.repo.get("u9");
    expect(player.wins + player.losses).toBeLessThanOrEqual(1);
    expect(player.coins).toBeGreaterThan(0);
    const ended = ctx.log.entries.find((e) => e.type === "battle_ended");
    expect(ended?.data).toMatchObject({
      userId: "u9",
      difficulty: "hard",
      forfeited: false,
    });
    // The battle is over, so old buttons are stale.
    const stale = await press(ctx, "u9", id, "end");
    expect(lastPayload(stale.update).content).toMatch(/ended or passed away/);
  });

  it("forfeiting ends the battle as a loss", async () => {
    const ctx = makeCtx(3);
    const { id } = await start(ctx);
    const click = await press(ctx, "u1", id, "forfeit");
    const update = lastPayload(click.update);
    expect(embedOf(update).title).toMatch(/Defeat/);
    expect(update.components).toEqual([]);
    expect(ctx.repo.get("u1")).toMatchObject({ losses: 1, wins: 0 });
    expect(
      ctx.log.entries.find((e) => e.type === "battle_ended")?.data,
    ).toMatchObject({ forfeited: true, winner: "top" });
  });

  it("a second /battle replaces the first, which then goes stale", async () => {
    const ctx = makeCtx(3);
    const first = await start(ctx);
    const second = await start(ctx);
    expect(second.id).not.toBe(first.id);
    expect(
      lastPayload((await press(ctx, "u1", first.id, "end")).update).content,
    ).toMatch(/ended or passed away/);
    expect(
      lastPayload((await press(ctx, "u1", second.id, "end")).update).embeds,
    ).toBeDefined();
  });

  it("someone else pressing the buttons never affects the owner's battle", async () => {
    const ctx = makeCtx(3);
    const { id } = await start(ctx, "owner");
    const stranger = await press(ctx, "stranger", id, "forfeit");
    expect(lastPayload(stranger.update).content).toMatch(
      /ended or passed away/,
    );
    expect(ctx.repo.get("owner").losses).toBe(0);
    expect(
      lastPayload((await press(ctx, "owner", id, "end")).update).embeds,
    ).toBeDefined();
  });

  it("when the enemy goes first it has already played by the time the player sees the board", async () => {
    let found = false;
    for (let seed = 1; seed <= 40 && !found; seed++) {
      const ctx = makeCtx(seed);
      const { payload } = await start(ctx, "u1", "hard");
      if (/The enemy goes first/.test(embedOf(payload).description)) {
        found = true;
        expect(embedOf(payload).title).toMatch(/Thy turn/);
        expect(rows(payload)[2].components.every((c: any) => !c.disabled)).toBe(
          true,
        );
        expect(
          ctx.log.entries.find((e) => e.type === "battle_started")?.data,
        ).toMatchObject({ first: "top" });
      }
    }
    expect(found).toBe(true);
  });

  it("a card that is too expensive is flagged in the menu and cannot be played", async () => {
    const ctx = makeCtx(3);
    const { payload, id } = await start(ctx);
    const expensive = rows(payload)[0].components[0].options.find((o: any) =>
      o.description.startsWith("Beyond thy means"),
    );
    if (expensive) {
      const click = await pick(ctx, "u1", id, expensive.value);
      expect(
        rows(lastPayload(click.update))[1].components.every(
          (c: any) => c.disabled,
        ),
      ).toBe(true);
    }
    expect(expensive).toBeDefined(); // turn 1 has 1 energy, so some hand card costs more
  });

  it("with images on, the battle is an attachment and the board is not repeated as text", async () => {
    const ctx = makeCtx(
      3,
      await createImageRenderer({ assetsDir: join(__dirname, "..", "assets") }),
    );
    const { payload, id } = await start(ctx);
    expect(payload.files).toHaveLength(1);
    expect(embedOf(payload).fields ?? []).toHaveLength(0);
    const click = await press(ctx, "u1", id, "end");
    const update = finalFrame(click);
    expect(update.files).toHaveLength(1);
    expect(update.attachments).toEqual([]); // drops the previous image
    expect(update.files[0].name).not.toBe(payload.files[0].name); // never a cached image
    // Every image-swapping frame of the animation also drops the prior image.
    for (const [frame] of click.editReply.mock.calls)
      expect((frame as any).attachments).toEqual([]);
  });

  it("animates the opponent's turn as several sequential render steps", async () => {
    // A seed where the human goes first, so pressing End hands over to the AI for a full turn.
    let found: Awaited<ReturnType<typeof start>> | null = null;
    let ctx!: Ctx;
    for (let seed = 1; seed <= 60; seed++) {
      ctx = makeCtx(seed);
      const started = await start(ctx, "u1", "hard");
      if (/Thou goest first/.test(embedOf(started.payload).description)) {
        found = started;
        break;
      }
    }
    expect(found).not.toBeNull();
    const { id } = found!;
    const click = await press(ctx, "u1", id, "end");
    // The acknowledge frame strips all controls while the opponent acts.
    expect(click.update).toHaveBeenCalledTimes(1);
    expect(lastPayload(click.update).components).toEqual([]);
    // Multiple sequential render steps: at least one timed editReply beat beyond the acknowledge.
    expect(click.editReply.mock.calls.length).toBeGreaterThan(0);
    const final = finalFrame(click);
    if (final.components.length === 0) {
      // The game ended during the AI turn: the end screen, no controls.
      expect(embedOf(final).title).toMatch(/Victory|Defeat|Draw/);
    } else {
      // Control returns to the player with all three rows re-enabled.
      expect(rows(final)).toHaveLength(3);
      expect(embedOf(final).title).toMatch(/Thy turn/);
    }
  });
});

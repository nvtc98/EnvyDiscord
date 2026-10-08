import { afterEach, describe, expect, it, vi } from "vitest";
import {
  animateOpeningTurn,
  opponentOpens,
  sessions,
  setBattleStepDelay,
  startBattle,
  type AnimationSurface,
  type BattleBoardPayload,
  type Session,
} from "../src/discord/battle-session";
import { advanceAiBeats } from "../src/engine/ai-playback";
import { CARD_INDEX, COLLECTIBLE_CARDS } from "../src/data/cards";
import { NPC_INDEX, npcDeck } from "../src/data/npcs";
import type { CardDef } from "../src/engine/types";
import { dmChannel, makeCtx } from "./discord-helpers";

setBattleStepDelay(0); // no real timers

const playerDeck = (): CardDef[] => COLLECTIBLE_CARDS.slice(0, 12);
const boSpd = () => NPC_INDEX.get("bo-spd")!;

afterEach(() => {
  sessions.clear();
});

type Ctx = ReturnType<typeof makeCtx>;

/** A fake AnimationSurface recording the payloads each method is handed; interaction is null (launch). */
function fakeSurface() {
  const showFirstFrame = vi.fn(async (_p: BattleBoardPayload) => {});
  const editFrame = vi.fn(async (_p: BattleBoardPayload) => {});
  const showControls = vi.fn(async (_p: BattleBoardPayload) => {});
  const surface: AnimationSurface = {
    interaction: null,
    showFirstFrame,
    editFrame,
    showControls,
  };
  return { surface, showFirstFrame, editFrame, showControls };
}

/** The embed description (log) of a rendered board payload. */
const descOf = (p: BattleBoardPayload): string =>
  (p.embeds[0].toJSON().description as string) ?? "";

/** The text "Board" field of a rendered board payload (text mode, no image renderer). */
const boardFieldOf = (p: BattleBoardPayload): string => {
  const fields = (p.embeds[0].toJSON().fields ?? []) as {
    name: string;
    value: string;
  }[];
  return fields.find((f) => f.name === "Board")?.value ?? "";
};

/** Start the Bò SPD opening (opponent-first), returning the live session (AI has NOT moved yet). */
function startBoSpdOpening(ctx: Ctx, userId: string): Session {
  return startBattle({
    ctx,
    userId,
    username: userId,
    deck: playerDeck(),
    opponentDeck: npcDeck(boSpd(), CARD_INDEX),
    opponentGuaranteedOpening: boSpd().guaranteedOpening,
    opponentGoesFirst: true,
    difficulty: "normal",
    variants: {},
  });
}

describe("opening animation — opponent-first", () => {
  it("animates every visible beat; the first frame shows the enemy's opening card on the board", async () => {
    const ctx = makeCtx(3);
    const session = startBoSpdOpening(ctx, "a");

    // Compute the visible beats independently (same seeded rng) so we know how many frames to expect.
    const probeCtx = makeCtx(3);
    const probe = startBoSpdOpening(probeCtx, "probe");
    const playback = advanceAiBeats(
      probe.state,
      probe.difficulty,
      probeCtx.rng,
      "bottom",
    );
    const visibleCount = playback.beats.filter(
      (b) => b.lines.length > 0,
    ).length;
    expect(visibleCount).toBeGreaterThan(0);
    sessions.delete("probe");

    const { surface, showFirstFrame, editFrame, showControls } = fakeSurface();
    await animateOpeningTurn(ctx, session, surface);

    // Frame 0 shown exactly once; one editFrame per LATER visible beat (index 0 is NOT skipped).
    expect(showFirstFrame).toHaveBeenCalledTimes(1);
    expect(editFrame).toHaveBeenCalledTimes(visibleCount - 1);
    expect(showFirstFrame.mock.calls.length + editFrame.mock.calls.length).toBe(
      visibleCount,
    );

    // The FIRST rendered frame shows the enemy's opening card on the board (a ▼ marker), NOT the empty
    // pre-move board.
    const firstBoard = boardFieldOf(showFirstFrame.mock.calls[0][0]);
    expect(firstBoard).toContain("▼"); // an enemy card is on the board

    // Final state: back to the human, game not over, snapshot captured, log carries the enemy opening.
    expect(session.state.active).toBe("bottom");
    expect(session.state.winner).toBeNull();
    expect(session.turnSnapshot).not.toBeNull();
    expect(session.log.some((l) => /The enemy goes first\./.test(l))).toBe(
      true,
    );
    expect(session.log.some((l) => /enemy played/i.test(l))).toBe(true);
    // Controls were restored once at the end.
    expect(showControls).toHaveBeenCalledTimes(1);
  });

  it("startBattle leaves the opening unplayed (enemy lanes empty, opening card still in hand)", () => {
    const ctx = makeCtx(3);
    const session = startBoSpdOpening(ctx, "b");
    expect(opponentOpens(session)).toBe(true);
    expect(session.state.active).toBe("top");
    // The opponent's board lanes are empty — the opening move has NOT been applied.
    const topOnBoard = session.state.lanes
      .flat()
      .filter((c) => c && c.owner === "top");
    expect(topOnBoard).toHaveLength(0);
    // The enemy hand still holds the guaranteed opening card.
    const topHand = session.state.players.top.hand.map((c) => c.def.id);
    expect(topHand).toContain("bo-sieu-phan-ong-cap-1");
    // startBattle did NOT capture a snapshot (control is with the enemy).
    expect(session.turnSnapshot).toBeNull();
  });
});

describe("opening animation — log parity (HIGH-1 opening side)", () => {
  it("the post-animation log tail equals the old [...opening, ...describeEvents(aiEvents,'bottom')]", async () => {
    const ctx = makeCtx(3);
    const session = startBoSpdOpening(ctx, "c");
    const openingLines = [...session.log]; // the opening line(s) seeded by startBattle

    // Independently compute the OLD expected enemy tail for the same seeded rng (advanceAiBeats on the
    // pre-move state consumes rng identically to the deleted advanceAi).
    const probeCtx = makeCtx(3);
    const probe = startBoSpdOpening(probeCtx, "probe");
    const playback = advanceAiBeats(
      probe.state,
      probe.difficulty,
      probeCtx.rng,
      "bottom",
    );
    // describeEvents(aiEvents,"bottom") == the concatenation of each beat's (bottom-worded) lines.
    const expectedEnemyLines = playback.beats.flatMap((b) => b.lines);
    const expected = [...openingLines, ...expectedEnemyLines];
    sessions.delete("probe");

    const { surface } = fakeSurface();
    await animateOpeningTurn(ctx, session, surface);

    // The settled log is trimmed to MAX_LOG_LINES; assert it ends with the expected opening+enemy tail.
    const log = session.log;
    const tail = log.slice(-expected.length);
    expect(tail).toEqual(expected.slice(-expected.length));
  });
});

describe("human-first unchanged + snapshot capture point (MEDIUM-5)", () => {
  it("human-first captures the snapshot in startBattle with opening line(s) only, no enemy lines", () => {
    const ctx = makeCtx(3);
    const session = startBattle({
      ctx,
      userId: "d",
      username: "d",
      deck: playerDeck(),
      opponentDeck: npcDeck(boSpd(), CARD_INDEX),
      opponentGuaranteedOpening: boSpd().guaranteedOpening,
      first: "bottom",
      difficulty: "normal",
      variants: {},
    });
    expect(opponentOpens(session)).toBe(false);
    expect(session.state.active).toBe("bottom");
    // Snapshot captured by startBattle (not by restoreHumanControls — no animation runs here).
    expect(session.turnSnapshot).not.toBeNull();
    // turnStartLog is the opening line(s) ONLY — no enemy move lines (the enemy never moved).
    expect(session.turnStartLog).toEqual(["You go first."]);
    expect(session.turnStartLog!.some((l) => /enemy played/i.test(l))).toBe(
      false,
    );
  });

  it("opponent-first leaves turnSnapshot null until the opening animates", async () => {
    const ctx = makeCtx(3);
    const session = startBoSpdOpening(ctx, "e");
    expect(session.turnSnapshot).toBeNull(); // startBattle's active==="bottom" block skipped
    const { surface } = fakeSurface();
    await animateOpeningTurn(ctx, session, surface);
    expect(session.turnSnapshot).not.toBeNull(); // captured by restoreHumanControls
  });
});

describe("random /battle first-mover (no opt-in)", () => {
  it("a top-resolving seed sets opponentOpens true and animates; a bottom-resolving seed does not", async () => {
    // Find a seed whose default first-mover resolves to top (rng() >= 0.5) and one that resolves to bottom.
    let topSeed = -1;
    let bottomSeed = -1;
    for (let seed = 1; seed <= 100 && (topSeed < 0 || bottomSeed < 0); seed++) {
      const ctx = makeCtx(seed);
      const session = startBattle({
        ctx,
        userId: "probe",
        username: "probe",
        deck: playerDeck(),
        opponentDeck: COLLECTIBLE_CARDS.slice(0, 12),
        difficulty: "normal",
        variants: {},
      });
      if (session.state.first === "top" && topSeed < 0) topSeed = seed;
      if (session.state.first === "bottom" && bottomSeed < 0) bottomSeed = seed;
      sessions.delete("probe");
    }
    expect(topSeed).toBeGreaterThan(0);
    expect(bottomSeed).toBeGreaterThan(0);

    // Top seed: opponentOpens true, animation drives at least one frame.
    const topCtx = makeCtx(topSeed);
    const topSession = startBattle({
      ctx: topCtx,
      userId: "top",
      username: "top",
      deck: playerDeck(),
      opponentDeck: COLLECTIBLE_CARDS.slice(0, 12),
      difficulty: "normal",
      variants: {},
    });
    expect(opponentOpens(topSession)).toBe(true);
    const { surface, showFirstFrame } = fakeSurface();
    await animateOpeningTurn(topCtx, topSession, surface);
    expect(showFirstFrame).toHaveBeenCalledTimes(1);
    expect(topSession.state.active).toBe("bottom");

    // Bottom seed: opponentOpens false (no animation).
    const bottomCtx = makeCtx(bottomSeed);
    const bottomSession = startBattle({
      ctx: bottomCtx,
      userId: "bottom",
      username: "bottom",
      deck: playerDeck(),
      opponentDeck: COLLECTIBLE_CARDS.slice(0, 12),
      difficulty: "normal",
      variants: {},
    });
    expect(opponentOpens(bottomSession)).toBe(false);
  });
});

describe("resume does NOT re-animate", () => {
  it("the RESUME branch of launchStoryBattle sends once and never edits (no opening animation)", async () => {
    const ctx = makeCtx(3);
    const { launchStoryBattle } = await import("../src/discord/story-battle");
    const { toStoryBattleState } =
      await import("../src/discord/battle-session");

    // Build an unfinished, human-turn snapshot by starting a human-first battle and serialising it.
    const seed = startBattle({
      ctx,
      userId: "resume",
      username: "resume",
      deck: playerDeck(),
      opponentDeck: npcDeck(boSpd(), CARD_INDEX),
      first: "bottom",
      difficulty: "normal",
      variants: {},
    });
    const snap = toStoryBattleState(seed);
    expect(snap.state.active).toBe("bottom");
    expect(snap.state.winner).toBeNull();
    sessions.clear(); // drop the in-memory session so launchStoryBattle takes the RESUME path

    const player = ctx.repo.get("resume");
    player.story = {
      node: "cave_battle",
      name: "abyss",
      isEye: true,
      knowsTribe: true,
      nameAttempts: [],
      pendingName: null,
      notice: null,
      pack: null,
      starterClaimed: true,
      liveMessageId: null,
      chapter: null,
      battle: snap,
      caveWon: false,
    };
    await ctx.repo.save(player);

    const dm = dmChannel();
    await launchStoryBattle(
      ctx,
      { id: "resume", username: "resume" },
      ctx.repo.get("resume"),
      dm as never,
      null,
    );
    expect(dm.send).toHaveBeenCalledTimes(1); // one board re-send
    expect(dm.edit).not.toHaveBeenCalled(); // never animated
    expect(sessions.get("resume")?.origin).toBe("story");
  });

  it("the already-battling-in-memory branch re-sends once and never edits", async () => {
    const ctx = makeCtx(3);
    const { launchStoryBattle } = await import("../src/discord/story-battle");

    // A live story session already in memory.
    startBattle({
      ctx,
      userId: "live",
      username: "live",
      deck: playerDeck(),
      opponentDeck: npcDeck(boSpd(), CARD_INDEX),
      first: "bottom",
      difficulty: "normal",
      variants: {},
      origin: "story",
    });

    const player = ctx.repo.get("live");
    player.story = {
      node: "cave_battle",
      name: "abyss",
      isEye: true,
      knowsTribe: true,
      nameAttempts: [],
      pendingName: null,
      notice: null,
      pack: null,
      starterClaimed: true,
      liveMessageId: null,
      chapter: null,
      battle: null,
      caveWon: false,
    };
    await ctx.repo.save(player);

    const dm = dmChannel();
    await launchStoryBattle(
      ctx,
      { id: "live", username: "live" },
      ctx.repo.get("live"),
      dm as never,
      null,
    );
    expect(dm.send).toHaveBeenCalledTimes(1);
    expect(dm.edit).not.toHaveBeenCalled();
  });
});

/** The component rows of a rendered payload as plain JSON. */
const rowsOf = (p: any): any[] =>
  (p.components ?? []).map((r: any) => r.toJSON());
const buttonsOf = (p: any): any[] =>
  rowsOf(p).flatMap((r: any) => r.components);

describe("story FRESH opening (integration) — controls restored, no second image, mirror authority", () => {
  it("posts control-less, edits per visible beat with stripped attachments, restores controls, mirrors post-opening", async () => {
    const ctx = makeCtx(3);
    const { launchStoryBattle } = await import("../src/discord/story-battle");

    const player = ctx.repo.get("fresh");
    player.story = {
      node: "cave_battle",
      name: "abyss",
      isEye: true,
      knowsTribe: true,
      nameAttempts: [],
      pendingName: null,
      notice: null,
      pack: null,
      starterClaimed: true,
      liveMessageId: null,
      chapter: null,
      battle: null,
      caveWon: false,
    };
    await ctx.repo.save(player);

    const dm = dmChannel();
    await launchStoryBattle(
      ctx,
      { id: "fresh", username: "fresh" },
      ctx.repo.get("fresh"),
      dm as never,
      null,
    );

    // The FIRST send carried NO components (control-less opening board).
    expect(buttonsOf(dm.send.mock.calls[0][0])).toHaveLength(0);
    // dm.edit was called at least once (the opening animation frames + the final controls edit).
    expect(dm.edit).toHaveBeenCalled();
    // Every animation-frame edit dropped prior attachments.
    for (const [, payload] of dm.edit.mock.calls)
      expect((payload as any).attachments).toEqual([]);
    // The FINAL edit (showControls) carries live battle buttons AND dropped attachments (no 2nd image).
    const finalEdit = dm.edit.mock.calls.at(-1)![1] as any;
    const finalButtons = buttonsOf(finalEdit);
    expect(finalButtons.length).toBeGreaterThan(0);
    expect(
      finalButtons.some((b) => (b.custom_id ?? "").startsWith("battle:")),
    ).toBe(true);
    expect(finalEdit.attachments).toEqual([]);

    // The repo mirror reflects the POST-opening (human-turn) state (written by mirrorStoryBattle).
    const saved = ctx.repo.get("fresh").story!.battle!;
    expect(saved.state.active).toBe("bottom");
    expect(saved.state.winner).toBeNull();
    // The enemy has moved in the mirrored state (it is NOT the pre-opening enemy-start snapshot).
    const topOnBoard = saved.state.lanes
      .flat()
      .filter((c) => c && c.owner === "top");
    expect(topOnBoard.length).toBeGreaterThan(0);
  });
});

describe("practice opponent-opens (integration) — single ack, controls restored", () => {
  it("replies once control-less, then only editReplies; final frame has live controls and no attachment", async () => {
    const { battleCommand } = await import("../src/discord/commands/battle");
    const { slashInteraction, ownEverything } =
      await import("./discord-helpers");
    const { setFetchAvatar } = await import("../src/render/avatar");
    setFetchAvatar(async () => null);

    // Find a seed where the REAL /battle command (its own deck resolution consumes rng) lands the
    // opponent as first mover, by running the command and inspecting the battle_started log.
    let ctx!: ReturnType<typeof makeCtx>;
    let interaction!: ReturnType<typeof slashInteraction>;
    let found = false;
    for (let seed = 1; seed <= 100 && !found; seed++) {
      const c = makeCtx(seed);
      ownEverything(c, "owner");
      const it = slashInteraction("owner", { difficulty: "normal" });
      await battleCommand.execute(it as never, c);
      const started = c.log.entries.find((e) => e.type === "battle_started");
      if (started?.data.first === "top") {
        ctx = c;
        interaction = it;
        found = true;
      } else {
        sessions.delete("owner");
      }
    }
    expect(found).toBe(true);
    void ctx;

    // SINGLE ack: the first (and only) reply is the control-less opening board; every subsequent frame
    // is an editReply (which shares the reply spy in this fake). No deferReply — no second ack path.
    expect(interaction.deferReply).not.toHaveBeenCalled();
    // The FIRST call (the one true reply ack) was control-less, and carried the ephemeral flag.
    const firstReply = interaction.reply.mock.calls[0][0] as any;
    expect(buttonsOf(firstReply)).toHaveLength(0);
    expect(firstReply.flags).toBeDefined();
    // Later calls are editReplies; the final one restores controls.
    const calls = interaction.reply.mock.calls.map((c) => c[0] as any);
    const final = calls.at(-1);
    const finalButtons = buttonsOf(final);
    expect(finalButtons.length).toBeGreaterThan(0);
    expect(
      finalButtons.some((b) => (b.custom_id ?? "").startsWith("battle:")),
    ).toBe(true);
    expect(final.attachments).toEqual([]);

    setFetchAvatar();
  });
});

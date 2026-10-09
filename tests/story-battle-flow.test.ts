import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { battleCommand } from "../src/discord/commands/battle";
import { setBattleStepDelay } from "../src/discord/battle-session";
import {
  resetLiveGateMessages,
  resetTutorialContinue,
  setStorySleep,
  storyCommand,
} from "../src/discord/commands/story";
import { GATE } from "../src/story/prologue";
import { setFetchAvatar } from "../src/render/avatar";
import {
  buttonInteraction,
  dmButtonInteraction,
  dmChannel,
  makeCtx,
  rows,
} from "./discord-helpers";

type Ctx = ReturnType<typeof makeCtx>;
type Dm = ReturnType<typeof dmChannel>;

const buttons = (payload: any): any[] =>
  rows(payload).flatMap((r) => r.components);
const labels = (payload: any) => buttons(payload).map((b) => b.label);
const content = (payload: any): string => payload.content as string;

/** The latest DM message that still carries buttons — the one the player acts on. */
const live = (dm: Dm): any =>
  [...dm.sent].reverse().find((p) => buttons(p).length > 0);

/** The latest DM message carrying a `battle:` component (the live battle board). */
const liveBattle = (dm: Dm): any =>
  [...dm.sent]
    .reverse()
    .find((p) =>
      buttons(p).some((b: any) => (b.custom_id ?? "").startsWith("battle:")),
    );

async function pressGate(ctx: Ctx, dm: Dm, label: string, userId = "u") {
  const gate = dm.sent.at(-1);
  const button = buttons(gate).find((b: any) => b.label === label);
  // Press the gate on the message the handler recorded as live, or the handleGate stale guard treats
  // it as an old gate and refuses to begin/resume (strips buttons without delivering the scene).
  const press = dmButtonInteraction(
    userId,
    button.custom_id,
    dm.idOf(gate),
    dm,
  );
  await storyCommand.component!(press as never, ctx);
}

/** Presses the live story button whose label matches, then returns. */
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
}

/** Walks a fresh player through the prologue + chapter up to (and accepting) the cave battle. */
async function walkToBattle(ctx: Ctx, userId = "u"): Promise<Dm> {
  const call = {
    user: {
      id: userId,
      username: `user${userId}`,
      displayAvatarURL: () => `https://cdn.example/${userId}.png`,
      createDM: async () => dm,
    },
    options: { getString: () => null, getBoolean: () => null },
    client: { application: { fetch: async () => ({ owner: { id: userId } }) } },
    reply: async () => undefined,
    deferReply: async () => undefined,
    editReply: async () => undefined,
  };
  const dm = dmChannel();
  await storyCommand.execute(call as never, ctx);
  await pressGate(ctx, dm, GATE.readyYes, userId);
  // greeting -> ask_name (Eye) -> name -> ... -> book -> take -> chapter -> cave_terms -> accept
  await click(ctx, dm, "Yes, I am one of The Eyes", userId);
  // submit the name via the modal flow
  const askPayload = live(dm);
  const inputBtn = buttons(askPayload).find((b: any) =>
    b.custom_id.endsWith(":input"),
  );
  const liveId = ctx.repo.get(userId).story!.liveMessageId!;
  const open = {
    ...dmButtonInteraction(userId, inputBtn.custom_id, liveId, dm),
    showModal: async (_m: unknown) => undefined,
    isButton: () => true,
  };
  let captured: any;
  open.showModal = async (m: any) => {
    captured = m;
  };
  await storyCommand.component!(open as never, ctx);
  const submit = {
    user: { id: userId, username: `user${userId}` },
    customId: captured.toJSON().custom_id,
    fields: { getTextInputValue: () => "abyss" },
    isFromMessage: () => true,
    message: { id: liveId },
    channel: dm,
    update: async () => undefined,
    reply: async () => undefined,
  };
  await storyCommand.modal!(submit as never, ctx);
  // name_exact -> tribe -> known -> curse -> map -> wisdom -> book
  await click(ctx, dm, "Continue", userId); // name_exact -> tribe
  await click(ctx, dm, "Yes, I know where they are", userId); // tribe -> tribe_known
  await click(ctx, dm, "Continue", userId); // tribe_known -> curse
  await click(ctx, dm, "Continue", userId); // curse -> map
  await click(ctx, dm, "The Eyes Of Wisdom", userId); // map -> wisdom
  await click(ctx, dm, "Just open the book", userId); // wisdom -> book
  await click(ctx, dm, "Take these cards", userId); // book -> book_taken
  await click(ctx, dm, "Continue", userId); // book_taken -> deck_praise
  await click(ctx, dm, "Continue", userId); // deck_praise -> to_bo_tuoi (map)
  await click(ctx, dm, "Bò Tuôi", userId); // to_bo_tuoi -> sea_cliff
  await click(ctx, dm, "Continue", userId); // sea_cliff -> curse_underground
  await click(ctx, dm, "Enter the cave", userId); // curse_underground -> cave_mouth
  await click(ctx, dm, "Continue", userId); // cave_mouth -> reveal_face
  await click(ctx, dm, "I am ready", userId); // reveal_face -> cave_terms
  // Accept launches the battle. On the FIRST (tutorial) duel the launch fires spoken beats
  // (battle-start, then the opening after-enemy-turn), each of which now BLOCKS on a "Continue" gate.
  // So the Accept handler does not resolve until those Continue presses arrive — drive the press loop
  // concurrently until the launch settles.
  const accepted = clickNoAwait(ctx, dm, "Accept", userId);
  await drainContinues(ctx, dm, accepted, userId);
  return dm;
}

/** Like {@link click} but returns the handler promise without awaiting (so a Continue gate can block it). */
function clickNoAwait(
  ctx: Ctx,
  dm: Dm,
  label: string,
  userId = "u",
): Promise<void> {
  const payload = live(dm);
  const button = buttons(payload).find((b: any) => b.label === label);
  if (!button)
    throw new Error(
      `No button "${label}" among: ${labels(payload).join(", ")}`,
    );
  const liveId = ctx.repo.get(userId).story!.liveMessageId!;
  const press = dmButtonInteraction(userId, button.custom_id, liveId, dm);
  return storyCommand.component!(press as never, ctx) as Promise<void>;
}

/**
 * Press "Continue" whenever a tutorial beat is parked on the gate, until the given promise settles.
 * Each loop: let microtasks drain, press Continue if a resolver is parked, repeat. A hard iteration
 * cap guards against an infinite loop if the promise never resolves.
 */
async function drainContinues(
  ctx: Ctx,
  dm: Dm,
  until: Promise<void>,
  userId = "u",
): Promise<void> {
  let settled = false;
  const done = until.then(() => {
    settled = true;
  });
  const macrotask = () => new Promise<void>((r) => setTimeout(r, 0));
  for (let i = 0; i < 200 && !settled; i++) {
    // Yield a macrotask so the parked onBeat (and the animation's delay(0)) can run and register a
    // resolver before we try to resolve it.
    await macrotask();
    if (settled) break;
    await pressContinue(ctx, userId);
    // Let the unblocked callback run its reanchor / fire the next beat before the next press.
    await macrotask();
  }
  await done;
}

/** Presses a battle control; routes through the shared battle component handler. */
async function battlePress(
  ctx: Ctx,
  dm: Dm,
  kind: string,
  userId = "u",
  arg?: string,
) {
  const board = liveBattle(dm);
  const id = buttons(board)
    .find((b: any) => (b.custom_id ?? "").startsWith("battle:"))
    .custom_id.split(":")[1];
  const press = {
    ...buttonInteraction(userId, `battle:${id}:${kind}${arg ? `:${arg}` : ""}`),
    message: { id: "battle-msg" },
    channel: dm,
    user: {
      id: userId,
      username: `user${userId}`,
      displayAvatarURL: () => `https://cdn.example/${userId}.png`,
    },
  };
  await battleCommand.component!(press as never, ctx);
  return press;
}

beforeEach(() => {
  // The live-message tracker is process-local; clear it so ids from one test can't leak into another.
  resetLiveGateMessages();
  // The Continue-gate resolver registry is likewise process-local; clear it between tests.
  resetTutorialContinue();
  setBattleStepDelay(0); // no real animation timers; keep the Continue-drain loop fast + deterministic
  setStorySleep(async () => {});
  setFetchAvatar(async () => null); // no network; player avatar -> placeholder
});
afterEach(() => {
  setStorySleep();
  setFetchAvatar();
});

describe("story -> cave battle integration", () => {
  it("accepting the terms launches a real battle in the DM with the player's deck", async () => {
    const ctx = makeCtx(3);
    const dm = await walkToBattle(ctx, "launch");
    expect(ctx.repo.get("launch").story!.node).toBe("cave_battle");
    const board = liveBattle(dm);
    expect(board).toBeDefined();
    // The board carries battle: components and is backed by a saved snapshot for resume.
    expect(ctx.repo.get("launch").story!.battle).not.toBeNull();
    expect(ctx.repo.get("launch").story!.battle!.opponentPortrait).toBe(
      "boss-spd-battle",
    );
    const started = ctx.log.entries.find(
      (e) => e.type === "battle_started",
    )?.data;
    expect(started).toMatchObject({ origin: "story" });
    // Bò SPD plays its fixed deck (11 bo-tuoi + 1 cap-1), not a random 12 — order-independent.
    const enemyDeck = started!.enemyDeck as string[];
    expect(enemyDeck).toHaveLength(12);
    expect(enemyDeck.filter((id) => id === "bo-tuoi")).toHaveLength(11);
    expect(
      enemyDeck.filter((id) => id === "bo-sieu-phan-ong-cap-1"),
    ).toHaveLength(1);
    // Bò SPD moves first in the story duel.
    expect(started!.first).toBe("top");
  });

  it("losing the battle (forfeit) delivers cave_loss and offers a retry that starts a fresh game", async () => {
    const ctx = makeCtx(3);
    const dm = await walkToBattle(ctx, "lose");
    const battleBefore = ctx.repo.get("lose").story!.battle;
    expect(battleBefore).not.toBeNull();

    await battlePress(ctx, dm, "forfeit", "lose");
    const player = ctx.repo.get("lose");
    expect(player.story!.node).toBe("cave_loss");
    expect(player.losses).toBe(1);
    // the loss keeps the (finished) snapshot so retry can clear it
    expect(player.story!.battle).not.toBeNull();
    expect(player.story!.caveWon).toBe(false);
    // cave_loss offers a single retry button
    const loss = live(dm);
    expect(labels(loss)).toEqual(["Try again"]);

    // retry: clears the lost snapshot and launches a brand-new battle
    await click(ctx, dm, "Try again", "lose");
    expect(ctx.repo.get("lose").story!.node).toBe("cave_battle");
    expect(liveBattle(dm)).toBeDefined();
  });

  it("winning the battle delivers chapter_end, records one win and clears the saved battle", async () => {
    const ctx = makeCtx(3);
    const dm = await walkToBattle(ctx, "win");
    const { sessions } = await import("../src/discord/battle-session");
    const session = sessions.get("win")!;
    expect(session.origin).toBe("story");

    // Force the engine to a player win, then drive the game-over branch exactly as a real finish does:
    // delete the session (award-once) and invoke the injected story-end callback.
    session.state = { ...session.state, winner: "bottom" };
    sessions.delete("win");
    const fakeInteraction = {
      user: {
        id: "win",
        username: "userwin",
        displayAvatarURL: () => "https://cdn.example/win.png",
      },
      update: async () => undefined,
    };
    await session.onStoryEnd!(session, "won", fakeInteraction as never);

    const player = ctx.repo.get("win");
    expect(player.story!.node).toBe("chapter_end");
    expect(player.wins).toBe(1);
    expect(player.losses).toBe(0);
    expect(player.story!.caveWon).toBe(true);
    expect(player.story!.battle).toBeNull();
    // chapter_end's closing line was delivered to the DM; it is a dead-end scene (no new choices).
    expect(
      dm.sent.some((p) => content(p)?.match(/the tale continues anon/i)),
    ).toBe(true);
    expect(
      ctx.log.entries.find((e) => e.type === "battle_ended")?.data,
    ).toMatchObject({ origin: "story" });
  });

  it("resuming via /story mid-battle rebuilds the session and re-sends the board", async () => {
    const ctx = makeCtx(3);
    const dm = await walkToBattle(ctx, "resume");
    expect(ctx.repo.get("resume").story!.node).toBe("cave_battle");
    // The in-memory session is dropped (simulating a restart) but the snapshot persists.
    const { sessions } = await import("../src/discord/battle-session");
    sessions.delete("resume");

    // A fresh /story -> resume gate -> resume rebuilds the battle from the snapshot.
    const call = {
      user: {
        id: "resume",
        username: "userresume",
        displayAvatarURL: () => "https://cdn.example/resume.png",
        createDM: async () => dm,
      },
      options: { getString: () => null, getBoolean: () => null },
      client: {
        application: { fetch: async () => ({ owner: { id: "resume" } }) },
      },
      reply: async () => undefined,
      deferReply: async () => undefined,
      editReply: async () => undefined,
    };
    await storyCommand.execute(call as never, ctx);
    const beforeResume = dm.sent.length;
    await pressGate(ctx, dm, GATE.resumeYes, "resume");
    // a new battle board was re-sent, and a live session exists again
    expect(dm.sent.length).toBeGreaterThan(beforeResume);
    expect(sessions.get("resume")?.origin).toBe("story");
    expect(ctx.repo.get("resume").story!.node).toBe("cave_battle");
  });
});

/** A fake beat driving a session's onBeat directly: only phase + a spy reanchor matter here. */
function fakeBeat(session: any, phase: string) {
  const reanchor = vi.fn(async () => {});
  return {
    ev: { session, phase, interaction: null, reanchor } as unknown as never,
    reanchor,
  };
}

/** Let pending microtasks/macrotasks drain so an async onBeat's bubble sends land before we assert. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** True when a payload carries the single `story:tut:continue` Continue button. */
const hasContinue = (payload: any): boolean =>
  buttons(payload).some(
    (b: any) => (b.custom_id ?? "") === "story:tut:continue",
  );

/**
 * Simulate the player pressing the "Continue" gate button: route a `story:tut:continue` button press
 * through the story component handler, as production does. Returns the press (so a test can inspect
 * its `update` spy — the ack that strips the button).
 */
async function pressContinue(ctx: Ctx, userId = "u") {
  const press = {
    ...buttonInteraction(userId, "story:tut:continue"),
    message: { id: "continue-msg" },
  };
  await storyCommand.component!(press as never, ctx);
  return press;
}

describe("in-battle tutorial wiring (first cave duel only)", () => {
  it("attaches onBeat/dm/boardMessageId on a FRESH first duel and sends the intro line before the board", async () => {
    const ctx = makeCtx(3);
    const dm = await walkToBattle(ctx, "tut");
    const { sessions } = await import("../src/discord/battle-session");
    const session = sessions.get("tut")!;
    expect(session.onBeat).toBeDefined();
    expect(session.dm).toBeDefined();
    // boardMessageId points at a posted board (kept current by battle-start's re-anchor).
    expect(session.boardMessageId).toBeTruthy();

    // The reassurance line was sent, and BEFORE the first battle board (ordering via dm.sent).
    const introIdx = dm.sent.findIndex(
      (p) => typeof p.content === "string" && p.content.includes("teach thee"),
    );
    const firstBoardIdx = dm.sent.findIndex((p) =>
      buttons(p).some((b: any) => (b.custom_id ?? "").startsWith("battle:")),
    );
    const anyBoardIdx = dm.sent.findIndex(
      (p) =>
        // the opening board is posted control-less, so match on the embed/attachment board instead
        Array.isArray(p.embeds) || Array.isArray(p.files),
    );
    expect(introIdx).toBeGreaterThanOrEqual(0);
    const boardIdx = firstBoardIdx >= 0 ? firstBoardIdx : anyBoardIdx;
    expect(boardIdx).toBeGreaterThanOrEqual(0);
    expect(introIdx).toBeLessThan(boardIdx);
    // battle-start fired at launch, so the goal lesson flag is set.
    expect(ctx.repo.get("tut").story!.tutorial!.goal).toBe(true);
  });

  it("onBeat sends + reanchors on a taught beat (after Continue is pressed), and is silent on a repeat", async () => {
    const ctx = makeCtx(3);
    const dm = await walkToBattle(ctx, "beat");
    const { sessions } = await import("../src/discord/battle-session");
    const session = sessions.get("beat")!;
    // after-player-play has NOT been taught yet (only battle-start + after-enemy-turn fired at launch),
    // so the first drive teaches it; the second is silent (teach-once).
    const sentBefore = dm.sent.length;
    const b1 = fakeBeat(session, "after-player-play");
    // The callback now BLOCKS on the Continue gate: start it, don't await yet.
    const parked = session.onBeat!(b1.ev);
    await flush(); // let the bubble sends land
    // A taught beat sent at least one bubble, but has NOT re-anchored (parked on the Continue wait).
    expect(dm.sent.length).toBeGreaterThan(sentBefore);
    expect(b1.reanchor).not.toHaveBeenCalled();
    // Press Continue, then the parked callback resolves and re-anchors exactly once.
    await pressContinue(ctx, "beat");
    await parked;
    expect(b1.reanchor).toHaveBeenCalledTimes(1);

    const sentAfterFirst = dm.sent.length;
    const b2 = fakeBeat(session, "after-player-play");
    await session.onBeat!(b2.ev);
    // The repeat is silent: nothing sent, no re-anchor, no Continue wait to resolve.
    expect(dm.sent.length).toBe(sentAfterFirst);
    expect(b2.reanchor).not.toHaveBeenCalled();
  });

  it("a spoken beat attaches a Continue button to the last bubble and blocks until pressed", async () => {
    const ctx = makeCtx(3);
    const dm = await walkToBattle(ctx, "gate");
    const { sessions } = await import("../src/discord/battle-session");
    const session = sessions.get("gate")!;
    const sentBefore = dm.sent.length;
    const b = fakeBeat(session, "after-player-play");
    const parked = session.onBeat!(b.ev);
    // Let the bubbles flush (sendTyping/pause/send are async) before inspecting.
    await flush();
    // The LAST bubble carries the Continue button, and the board has NOT re-anchored yet.
    const lastBubble = dm.sent.at(-1);
    expect(hasContinue(lastBubble)).toBe(true);
    expect(dm.sent.length).toBeGreaterThan(sentBefore);
    expect(b.reanchor).not.toHaveBeenCalled();
    // Press Continue: the handler strips the button (interaction.update) and resolves the wait.
    const press = await pressContinue(ctx, "gate");
    expect(press.update).toHaveBeenCalledWith({ components: [] });
    await parked;
    expect(b.reanchor).toHaveBeenCalledTimes(1);
  });

  it("locks the board while a lesson is up: strips the live board's buttons until Continue", async () => {
    const ctx = makeCtx(3);
    const dm = await walkToBattle(ctx, "lock");
    const { sessions } = await import("../src/discord/battle-session");
    const session = sessions.get("lock")!;
    const boardId = session.boardMessageId!;
    const b = fakeBeat(session, "after-player-play");
    const parked = session.onBeat!(b.ev);
    await flush();
    // While the lesson is up (before Continue), the live board's buttons were stripped: the tutorial
    // called clearComponents on the tracked board id so the player can't act on it mid-lesson.
    expect(dm.clearComponents).toHaveBeenCalledWith(boardId);
    expect(b.reanchor).not.toHaveBeenCalled();
    // After Continue, the parked callback re-anchors a fresh board (with controls) exactly once.
    await pressContinue(ctx, "lock");
    await parked;
    expect(b.reanchor).toHaveBeenCalledTimes(1);
  });

  it("a stale/duplicate Continue press with no pending resolver just acks and no-ops", async () => {
    const ctx = makeCtx(3);
    await walkToBattle(ctx, "stale");
    // Nothing is parked; a Continue press just acks (strips) and does not throw.
    const press = await pressContinue(ctx, "stale");
    expect(press.update).toHaveBeenCalledWith({ components: [] });
  });

  it("a silent beat attaches no Continue button, does not wait, and does not re-anchor", async () => {
    const ctx = makeCtx(3);
    const dm = await walkToBattle(ctx, "quiet");
    const { sessions } = await import("../src/discord/battle-session");
    const session = sessions.get("quiet")!;
    const sentBefore = dm.sent.length;
    const b = fakeBeat(session, "tide-shifted");
    // A silent beat resolves on its own (no Continue press needed) — await directly.
    await session.onBeat!(b.ev);
    expect(dm.sent.length).toBe(sentBefore);
    expect(b.reanchor).not.toHaveBeenCalled();
  });

  it("does NOT attach the tutorial on a replay after the cave is won (Fight again / caveWon)", async () => {
    const ctx = makeCtx(3);
    const dm = await walkToBattle(ctx, "replay");
    const { sessions } = await import("../src/discord/battle-session");
    // Simulate a prior win: the chapter is done, the snapshot cleared, caveWon set — then re-enter the
    // cave_battle node (Fight again) and relaunch FRESH.
    const player = ctx.repo.players.get("replay")!;
    player.story!.caveWon = true;
    player.story!.battle = null;
    player.story!.node = "cave_battle";
    player.story!.tutorial = {};
    await ctx.repo.save(player);
    sessions.delete("replay");

    const sentBefore = dm.sent.length;
    const { launchStoryBattle } = await import("../src/discord/story-battle");
    const fresh = ctx.repo.get("replay");
    await launchStoryBattle(
      ctx,
      { id: "replay", username: "userreplay" },
      fresh,
      dm as never,
      null,
    );
    const session = sessions.get("replay")!;
    expect(session.onBeat).toBeUndefined();
    expect(session.dm).toBeUndefined();
    expect(session.boardMessageId).toBeFalsy();
    // No intro line on a replay.
    expect(
      dm.sent
        .slice(sentBefore)
        .some(
          (p) =>
            typeof p.content === "string" && p.content.includes("teach thee"),
        ),
    ).toBe(false);
  });

  it("re-attaches onBeat/dm on resume WITHOUT re-firing battle-start (teach-once guards the goal lesson)", async () => {
    const ctx = makeCtx(3);
    const dm = await walkToBattle(ctx, "res2");
    const { sessions } = await import("../src/discord/battle-session");
    // battle-start fired on the fresh launch -> goal already taught.
    expect(ctx.repo.get("res2").story!.tutorial!.goal).toBe(true);
    // Drop the in-memory session (restart), keep the snapshot (mid-fight).
    sessions.delete("res2");

    const call = {
      user: {
        id: "res2",
        username: "userres2",
        displayAvatarURL: () => "https://cdn.example/res2.png",
        createDM: async () => dm,
      },
      options: { getString: () => null, getBoolean: () => null },
      client: {
        application: { fetch: async () => ({ owner: { id: "res2" } }) },
      },
      reply: async () => undefined,
      deferReply: async () => undefined,
      editReply: async () => undefined,
    };
    await storyCommand.execute(call as never, ctx);
    const sentBefore = dm.sent.length;
    await pressGate(ctx, dm, GATE.resumeYes, "res2");

    const session = sessions.get("res2")!;
    expect(session.onBeat).toBeDefined();
    expect(session.dm).toBeDefined();
    expect(session.boardMessageId).toBeTruthy();
    // No battle-start bubble re-sent on resume (goal flag already set; no runBattleStartBeat fired).
    const goalLessonResent = dm.sent
      .slice(sentBefore)
      .some(
        (p) =>
          typeof p.content === "string" && p.content.includes("three lanes"),
      );
    expect(goalLessonResent).toBe(false);
    // No intro line on resume either.
    expect(
      dm.sent
        .slice(sentBefore)
        .some(
          (p) =>
            typeof p.content === "string" && p.content.includes("teach thee"),
        ),
    ).toBe(false);
  });
});

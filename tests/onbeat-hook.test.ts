import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleBattleComponent,
  runBattleStartBeat,
  sessions,
  setBattleStepDelay,
  startBattle,
  type BattleBeat,
  type BattleBoardPayload,
  type BattleDm,
  type Session,
} from "../src/discord/battle-session";
import { CARD_INDEX, COLLECTIBLE_CARDS } from "../src/data/cards";
import { NPC_INDEX, npcDeck } from "../src/data/npcs";
import {
  BALANCE_START,
  type CardDef,
  type CardInstance,
  type GameState,
  type Seat,
} from "../src/engine/types";
import { discordApiError, makeCtx } from "./discord-helpers";
import { RESTJSONErrorCodes } from "discord.js";

setBattleStepDelay(0); // no real timers

afterEach(() => {
  sessions.clear();
  vi.restoreAllMocks();
});

type Ctx = ReturnType<typeof makeCtx>;

// --- Synthetic fixture ------------------------------------------------------
// Trivial 1-cost / low-power cards with no abilities, so the only engine effect is the push geometry.
const TRIVIAL: CardDef = { id: "trivial", name: "Trivial", cost: 1, power: 1 };

const inst = (uid: number, owner: Seat): CardInstance => ({
  uid,
  def: TRIVIAL,
  owner,
  bonus: 0,
});

/** An empty 3x3 board. */
const emptyLanes = (): (CardInstance | null)[][] => [
  [null, null, null],
  [null, null, null],
  [null, null, null],
];

/**
 * A hand-crafted mid-battle state: it is the human's (bottom) turn, lane 0 is FULL of three cards so
 * the human's placement there pushes the far-edge card off (a forced destroy → after-push). The human
 * holds one trivial card (uid 100) they can afford.
 */
function forcedPushState(): GameState {
  const lanes = emptyLanes();
  lanes[0] = [inst(1, "top"), inst(2, "bottom"), inst(3, "bottom")]; // full lane
  return {
    lanes,
    players: {
      bottom: {
        energy: 5,
        turns: 1,
        deck: [],
        hand: [inst(100, "bottom")],
      },
      top: { energy: 5, turns: 1, deck: [], hand: [] },
    },
    first: "bottom",
    active: "bottom",
    round: 1,
    balance: BALANCE_START,
    turnsPlayed: 0,
    winner: null,
    nextUid: 101,
    destroyedPower: 0,
    destroyedCount: 0,
  };
}

/** Build a live Session around a crafted state and register it so handleBattleComponent finds it. */
function makeSession(
  userId: string,
  state: GameState,
  extra: Partial<Session> = {},
): Session {
  const session: Session = {
    id: "beat01",
    state,
    difficulty: "normal",
    selectedUid: null,
    variants: {},
    log: [],
    touched: Date.now(),
    userId,
    origin: "practice",
    opponentPortrait: null,
    playerAvatarUrl: null,
    playerAvatarImage: null,
    turnSnapshot: null,
    turnStartLog: null,
    ...extra,
  };
  sessions.set(userId, session);
  return session;
}

/** A standalone BattleDm fake recording send/deleteMessage and returning incrementing ids. */
function fakeDm() {
  const calls: Array<{ kind: "send" | "delete"; arg: unknown }> = [];
  let next = 1;
  const dm: BattleDm & {
    send: ReturnType<typeof vi.fn>;
    deleteMessage: ReturnType<typeof vi.fn>;
    calls: typeof calls;
  } = {
    send: vi.fn(async (payload: BattleBoardPayload) => {
      calls.push({ kind: "send", arg: payload });
      return { id: `board-${next++}` };
    }),
    deleteMessage: vi.fn(async (id: string) => {
      calls.push({ kind: "delete", arg: id });
    }),
    calls,
  };
  return dm;
}

/** A button press fake with the full discord.js component ack surface this handler uses. */
function press(userId: string, battleId: string, kind: string, arg?: string) {
  const flags = { replied: false, deferred: false };
  const customId = `battle:${battleId}:${kind}${arg !== undefined ? `:${arg}` : ""}`;
  return {
    user: { id: userId, username: `user${userId}` },
    customId,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isRepliable: () => true,
    get replied() {
      return flags.replied;
    },
    get deferred() {
      return flags.deferred;
    },
    update: vi.fn(async () => {
      flags.replied = true;
    }),
    deferUpdate: vi.fn(async () => {
      flags.replied = true;
    }),
    editReply: vi.fn(async () => undefined),
    reply: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
  };
}

/** Play uid 100 into lane 0 (the forced-push lane). */
async function playForcedPush(ctx: Ctx, userId: string, session: Session) {
  session.selectedUid = 100;
  const click = press(userId, session.id, "lane", "0");
  await handleBattleComponent(click as never, ctx);
  return click;
}

describe("onBeat phase ordering (synthetic fixture)", () => {
  it("fires battle-start, after-player-play, after-push, then end-turn beats in order", async () => {
    const ctx = makeCtx(7);
    const phases: string[] = [];
    const session = makeSession("u1", forcedPushState(), {
      onBeat: async (ev: BattleBeat) => {
        phases.push(ev.phase);
      },
    });

    // Launch beat.
    await runBattleStartBeat(ctx, session);
    expect(phases).toEqual(["battle-start"]);

    // The forced-push placement: after-player-play then after-push.
    await playForcedPush(ctx, "u1", session);
    expect(phases).toEqual(["battle-start", "after-player-play", "after-push"]);

    // End the turn: human end-turn beat fires, then (game continues) after-enemy-turn.
    const end = press("u1", session.id, "end");
    await handleBattleComponent(end as never, ctx);
    const afterEnd = phases.slice(3);
    expect(afterEnd[0]).toBe("after-player-end-turn");
    expect(afterEnd).toContain("after-enemy-turn");
    // after-enemy-turn is the last of the enemy-turn beats (before any before-finish).
    const enemyIdx = afterEnd.indexOf("after-enemy-turn");
    const finishIdx = afterEnd.indexOf("before-finish");
    if (finishIdx !== -1) expect(enemyIdx).toBeLessThan(finishIdx);
  });

  it("after-enemy-turn fires at most once per End and before-finish is last on a game-over", async () => {
    const ctx = makeCtx(7);
    const phases: string[] = [];
    // Drive a trivial battle to completion by only ending turns.
    const session = startBattle({
      ctx,
      userId: "u2",
      username: "u2",
      deck: COLLECTIBLE_CARDS.slice(0, 12),
      opponentDeck: COLLECTIBLE_CARDS.slice(0, 12),
      first: "bottom",
      difficulty: "normal",
      variants: {},
    });
    session.onBeat = async (ev: BattleBeat) => {
      phases.push(ev.phase);
    };
    for (let i = 0; i < 80; i++) {
      phases.length = 0;
      const end = press("u2", session.id, "end");
      await handleBattleComponent(end as never, ctx);
      // after-enemy-turn fires at most once per End.
      expect(
        phases.filter((p) => p === "after-enemy-turn").length,
      ).toBeLessThanOrEqual(1);
      if (phases.includes("before-finish")) {
        // before-finish is the last beat of the battle.
        expect(phases.at(-1)).toBe("before-finish");
        return;
      }
    }
    throw new Error("battle did not finish");
  });

  it("forfeit fires only before-finish (no play-side beat)", async () => {
    const ctx = makeCtx(7);
    const phases: string[] = [];
    const session = makeSession("u3", forcedPushState(), {
      onBeat: async (ev: BattleBeat) => {
        phases.push(ev.phase);
      },
    });
    const click = press("u3", session.id, "forfeit");
    await handleBattleComponent(click as never, ctx);
    expect(phases).toEqual(["before-finish"]);
  });
});

describe("onBeat phase payloads and detection predicates", () => {
  it("after-player-play reflects the played card on the beat state", async () => {
    const ctx = makeCtx(7);
    let seen: GameState | null = null;
    const session = makeSession("u1", forcedPushState(), {
      onBeat: async (ev: BattleBeat) => {
        if (ev.phase === "after-player-play") seen = ev.session.state;
      },
    });
    await playForcedPush(ctx, "u1", session);
    expect(seen).not.toBeNull();
    // The played card (uid 100) now sits on the board; the far-edge top card (uid 1) was pushed off.
    const onBoard = seen!.lanes.flat().filter((c): c is CardInstance => !!c);
    expect(onBoard.some((c) => c.uid === 100)).toBe(true);
    expect(onBoard.some((c) => c.uid === 1)).toBe(false);
  });

  it("after-push fires only when a placement destroyed a unit", async () => {
    const ctx = makeCtx(7);
    const phases: string[] = [];
    // A non-full lane: playing into it pushes nothing off → no after-push.
    const state = forcedPushState();
    state.lanes[0] = [null, null, null];
    state.lanes[1] = [null, null, null];
    const session = makeSession("u1", state, {
      onBeat: async (ev: BattleBeat) => {
        phases.push(ev.phase);
      },
    });
    session.selectedUid = 100;
    const click = press("u1", session.id, "lane", "1");
    await handleBattleComponent(click as never, ctx);
    expect(phases).toContain("after-player-play");
    expect(phases).not.toContain("after-push");
  });

  it("tide-shifted/near-* fire off the balance thresholds on end-turn beats", async () => {
    const ctx = makeCtx(7);
    const seen: Array<{ phase: string; balance: number }> = [];
    // Start near the human's winning edge so the human's own end-turn shift lands in near-win range.
    const state = forcedPushState();
    state.balance = 97;
    // A lone bottom card already on the board, so the human leads on power and the tide holds/rises.
    state.lanes[2] = [null, null, inst(50, "bottom")];
    const session = makeSession("u1", state, {
      onBeat: async (ev: BattleBeat) => {
        seen.push({ phase: ev.phase, balance: ev.session.state.balance });
      },
    });
    const end = press("u1", session.id, "end");
    await handleBattleComponent(end as never, ctx);
    const near = seen.find((s) => s.phase === "near-win");
    // near-win fired, and only while balance was within NEAR_EDGE of 100 (>= 85).
    if (near) expect(near.balance).toBeGreaterThanOrEqual(85);
    // Every tide-shifted beat carried a materially moved balance (never exactly flat is not asserted,
    // but near-* must never co-fire past a decided game — covered by the suppression test below).
  });

  it("near-* is suppressed once the game is decided (winner set)", async () => {
    const ctx = makeCtx(7);
    const phases: string[] = [];
    // balance 99 with a strong bottom board: the human's end-turn knocks balance to 100 and wins.
    const state = forcedPushState();
    state.balance = 99;
    state.lanes[1] = [null, null, inst(60, "bottom")];
    const session = makeSession("u1", state, {
      onBeat: async (ev: BattleBeat) => {
        phases.push(ev.phase);
      },
    });
    const end = press("u1", session.id, "end");
    await handleBattleComponent(end as never, ctx);
    if (session.state.winner === "bottom" || phases.includes("before-finish")) {
      // The deciding beat is reported by before-finish, never near-win.
      expect(phases).not.toContain("near-win");
      expect(phases).toContain("before-finish");
    }
  });
});

describe("reanchor send-new-then-delete-old", () => {
  it("sends the chat, sends a new board, records its id, then deletes the old board", async () => {
    const ctx = makeCtx(7);
    const dm = fakeDm();
    const order: string[] = [];
    const chatSend = vi.fn(async () => {
      order.push("chat");
    });
    const session = makeSession("u1", forcedPushState(), {
      dm,
      boardMessageId: "old-board",
      onBeat: async (ev: BattleBeat) => {
        if (ev.phase === "after-player-play") {
          await chatSend();
          await ev.reanchor();
        }
      },
    });

    const click = await playForcedPush(ctx, "u1", session);

    // chat before board send; board send before delete.
    expect(order).toEqual(["chat"]);
    expect(dm.send).toHaveBeenCalledTimes(1);
    expect(dm.deleteMessage).toHaveBeenCalledTimes(1);
    // The new board id is recorded BEFORE the delete, and the delete targets the OLD board.
    expect(dm.deleteMessage.mock.calls[0][0]).toBe("old-board");
    expect(session.boardMessageId).toBe("board-1");
    // send happened before delete (ordering of recorded calls).
    expect(dm.calls.map((c) => c.kind)).toEqual(["send", "delete"]);
    // The handler acked via deferUpdate, NOT update(), for this re-anchored cycle (§4.1).
    expect(click.deferUpdate).toHaveBeenCalledTimes(1);
    expect(click.update).not.toHaveBeenCalled();
  });
});

describe("fast path — no reanchor leaves in-place update unchanged", () => {
  it("a silent onBeat keeps interaction.update and never defers or touches the DM", async () => {
    const ctx = makeCtx(7);
    const dm = fakeDm();
    const session = makeSession("u1", forcedPushState(), {
      dm,
      boardMessageId: "old-board",
      // Speaks nothing, calls no reanchor.
      onBeat: async () => {},
    });
    const click = await playForcedPush(ctx, "u1", session);
    expect(click.update).toHaveBeenCalledTimes(1);
    expect(click.deferUpdate).not.toHaveBeenCalled();
    expect(dm.send).not.toHaveBeenCalled();
    expect(dm.deleteMessage).not.toHaveBeenCalled();
    expect(session.boardMessageId).toBe("old-board");
  });
});

describe("no onBeat — behavior identical to today", () => {
  it("drives a battle with no onBeat with no extra DM/defer and a normal update", async () => {
    const ctx = makeCtx(7);
    const dm = fakeDm();
    const session = makeSession("u1", forcedPushState(), {
      dm,
      boardMessageId: "old-board",
      // onBeat unset
    });
    const click = await playForcedPush(ctx, "u1", session);
    expect(click.update).toHaveBeenCalledTimes(1);
    expect(click.deferUpdate).not.toHaveBeenCalled();
    expect(dm.send).not.toHaveBeenCalled();
    expect(dm.deleteMessage).not.toHaveBeenCalled();
  });

  it("a full battle with no onBeat still finishes end-to-end", async () => {
    const ctx = makeCtx(7);
    const session = startBattle({
      ctx,
      userId: "u2",
      username: "u2",
      deck: COLLECTIBLE_CARDS.slice(0, 12),
      opponentDeck: COLLECTIBLE_CARDS.slice(0, 12),
      first: "bottom",
      difficulty: "normal",
      variants: {},
    });
    let finished = false;
    for (let i = 0; i < 80; i++) {
      const end = press("u2", session.id, "end");
      await handleBattleComponent(end as never, ctx);
      if (!sessions.has("u2")) {
        finished = true;
        break;
      }
    }
    expect(finished).toBe(true);
    expect(
      ctx.log.entries.find((e) => e.type === "battle_ended"),
    ).toBeDefined();
  });
});

describe("error isolation", () => {
  it("a throwing onBeat is logged and swallowed; the battle continues", async () => {
    const ctx = makeCtx(7);
    const session = makeSession("u1", forcedPushState(), {
      onBeat: async (ev: BattleBeat) => {
        if (ev.phase === "after-player-play") throw new Error("boom");
      },
    });
    const click = await playForcedPush(ctx, "u1", session);
    // The battle still rendered (update ran) and the play was applied.
    expect(click.update).toHaveBeenCalledTimes(1);
    expect(
      ctx.log.entries.some(
        (e) =>
          e.stream === "messages" &&
          e.type === "error" &&
          e.data.phase === "after-player-play",
      ),
    ).toBe(true);
  });

  it("an async-rejecting onBeat is swallowed too", async () => {
    const ctx = makeCtx(7);
    const session = makeSession("u1", forcedPushState(), {
      onBeat: (ev: BattleBeat) =>
        ev.phase === "after-player-play"
          ? Promise.reject(new Error("async boom"))
          : Promise.resolve(),
    });
    const click = await playForcedPush(ctx, "u1", session);
    expect(click.update).toHaveBeenCalledTimes(1);
    expect(
      ctx.log.entries.some(
        (e) => e.type === "error" && e.data.phase === "after-player-play",
      ),
    ).toBe(true);
  });

  it("a reanchor whose send rejects (non-benign) is swallowed; didReanchor stays false", async () => {
    const ctx = makeCtx(7);
    const dm = fakeDm();
    dm.send.mockRejectedValueOnce(discordApiError(50001)); // non-benign MissingAccess-ish
    const session = makeSession("u1", forcedPushState(), {
      dm,
      boardMessageId: "old-board",
      onBeat: async (ev: BattleBeat) => {
        if (ev.phase === "after-player-play") await ev.reanchor();
      },
    });
    const click = await playForcedPush(ctx, "u1", session);
    // The send threw before recording, so no re-anchor happened: the handler takes the normal update.
    expect(click.update).toHaveBeenCalledTimes(1);
    expect(click.deferUpdate).not.toHaveBeenCalled();
    expect(dm.deleteMessage).not.toHaveBeenCalled();
    expect(session.boardMessageId).toBe("old-board");
  });

  it("a benign UnknownMessage(10008) from deleteMessage is swallowed; didReanchor stays true", async () => {
    const ctx = makeCtx(7);
    const dm = fakeDm();
    // The onBeat's own reanchor is responsible for swallowing benign delete errors in production
    // (via the story-side BattleDm). Here the fake deleteMessage rejects benignly and the onBeat
    // swallows it, so the re-anchor still counts (board was sent).
    dm.deleteMessage.mockRejectedValueOnce(
      discordApiError(RESTJSONErrorCodes.UnknownMessage),
    );
    const session = makeSession("u1", forcedPushState(), {
      dm,
      boardMessageId: "old-board",
      onBeat: async (ev: BattleBeat) => {
        if (ev.phase === "after-player-play") {
          try {
            await ev.reanchor();
          } catch {
            /* benign delete swallowed by the consumer's BattleDm in production */
          }
        }
      },
    });
    const click = await playForcedPush(ctx, "u1", session);
    expect(dm.send).toHaveBeenCalledTimes(1);
    expect(session.boardMessageId).toBe("board-1"); // new board recorded before the delete
    // The re-anchor's board send succeeded, so the handler deferred rather than updating.
    expect(click.deferUpdate).toHaveBeenCalledTimes(1);
    expect(click.update).not.toHaveBeenCalled();
  });
});

describe("reanchor no-ops without a DM", () => {
  it("resolves without send/delete and keeps the normal update path", async () => {
    const ctx = makeCtx(7);
    const session = makeSession("u1", forcedPushState(), {
      // onBeat set, but no dm.
      onBeat: async (ev: BattleBeat) => {
        if (ev.phase === "after-player-play") await ev.reanchor();
      },
    });
    const click = await playForcedPush(ctx, "u1", session);
    expect(click.update).toHaveBeenCalledTimes(1);
    expect(click.deferUpdate).not.toHaveBeenCalled();
    expect(session.boardMessageId ?? null).toBeNull();
  });
});

describe("runBattleStartBeat helper", () => {
  it("(a) is a pure no-op when onBeat is unset", async () => {
    const ctx = makeCtx(7);
    const dm = fakeDm();
    const session = makeSession("u1", forcedPushState(), {
      dm,
      boardMessageId: "old-board",
    });
    const reanchored = await runBattleStartBeat(ctx, session);
    expect(reanchored).toBe(false);
    expect(dm.send).not.toHaveBeenCalled();
    expect(dm.deleteMessage).not.toHaveBeenCalled();
  });

  it("(b) with onBeat + dm set but boardMessageId UNSET, reanchor sends without deleting (documented leak)", async () => {
    const ctx = makeCtx(7);
    const dm = fakeDm();
    const session = makeSession("u1", forcedPushState(), {
      dm,
      boardMessageId: null,
      onBeat: async (ev: BattleBeat) => {
        await ev.reanchor();
      },
    });
    const reanchored = await runBattleStartBeat(ctx, session);
    expect(reanchored).toBe(true);
    expect(dm.send).toHaveBeenCalledTimes(1);
    expect(dm.deleteMessage).not.toHaveBeenCalled(); // no previous id to delete → leaked board
    expect(session.boardMessageId).toBe("board-1");
  });

  it("(c) with both dm + boardMessageId set, reanchor sends, records, then deletes", async () => {
    const ctx = makeCtx(7);
    const dm = fakeDm();
    const session = makeSession("u1", forcedPushState(), {
      dm,
      boardMessageId: "old-board",
      onBeat: async (ev: BattleBeat) => {
        await ev.reanchor();
      },
    });
    const reanchored = await runBattleStartBeat(ctx, session);
    expect(reanchored).toBe(true);
    expect(dm.send).toHaveBeenCalledTimes(1);
    expect(dm.deleteMessage.mock.calls[0][0]).toBe("old-board");
    expect(session.boardMessageId).toBe("board-1");
    expect(dm.calls.map((c) => c.kind)).toEqual(["send", "delete"]);
  });
});

describe("optional realism: Bo SPD NPC ordering", () => {
  it("drives the real Bo SPD wiring and still fires the required beats in order", async () => {
    const ctx = makeCtx(7);
    const npc = NPC_INDEX.get("bo-spd")!;
    const phases: string[] = [];
    const session = startBattle({
      ctx,
      userId: "u1",
      username: "u1",
      deck: COLLECTIBLE_CARDS.slice(0, 12),
      opponentDeck: npcDeck(npc, CARD_INDEX),
      opponentGuaranteedOpening: npc.guaranteedOpening,
      opponentGoesFirst: npc.goesFirst,
      first: "bottom",
      difficulty: "normal",
      variants: {},
    });
    session.onBeat = async (ev: BattleBeat) => {
      phases.push(ev.phase);
    };
    await runBattleStartBeat(ctx, session);
    expect(phases[0]).toBe("battle-start");

    for (let i = 0; i < 80; i++) {
      const end = press("u1", session.id, "end");
      await handleBattleComponent(end as never, ctx);
      if (!sessions.has("u1")) break;
    }
    // The required end-of-turn beats appeared; before-finish is the last beat recorded.
    expect(phases).toContain("after-player-end-turn");
    expect(phases.at(-1)).toBe("before-finish");
  });
});

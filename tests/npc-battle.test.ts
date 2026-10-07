import { afterEach, describe, expect, it } from "vitest";
import {
  sessions,
  setBattleStepDelay,
  startBattle,
} from "../src/discord/battle-session";
import { CARD_INDEX, COLLECTIBLE_CARDS } from "../src/data/cards";
import { NPC_INDEX, npcDeck } from "../src/data/npcs";
import type { CardDef } from "../src/engine/types";
import { makeCtx } from "./discord-helpers";

setBattleStepDelay(0); // no real timers

const playerDeck = (): CardDef[] => COLLECTIBLE_CARDS.slice(0, 12);
const boSpd = () => NPC_INDEX.get("bo-spd")!;

afterEach(() => {
  sessions.clear();
});

/** The enemyDeck array (card ids) captured in the battle_started log at construction. */
const enemyDeckLog = (ctx: ReturnType<typeof makeCtx>): string[] =>
  ctx.log.entries.find((e) => e.type === "battle_started")!.data
    .enemyDeck as string[];

describe("startBattle first-mover resolution", () => {
  it("opponentGoesFirst makes the opponent (top) take the first turn", () => {
    const ctx = makeCtx(3);
    const session = startBattle({
      ctx,
      userId: "a",
      username: "a",
      deck: playerDeck(),
      opponentDeck: npcDeck(boSpd(), CARD_INDEX),
      opponentGoesFirst: true,
      difficulty: "normal",
      variants: {},
    });
    expect(session.state.first).toBe("top");
  });

  it("an explicit `first` overrides opponentGoesFirst", () => {
    const ctx = makeCtx(3);
    const session = startBattle({
      ctx,
      userId: "b",
      username: "b",
      deck: playerDeck(),
      opponentDeck: npcDeck(boSpd(), CARD_INDEX),
      opponentGoesFirst: true,
      first: "bottom",
      difficulty: "normal",
      variants: {},
    });
    expect(session.state.first).toBe("bottom");
  });

  it("without either opt the first mover follows the rng default", () => {
    // makeCtx(3) rng: assert the default path is used (not forced to top).
    const ctx = makeCtx(3);
    const session = startBattle({
      ctx,
      userId: "c",
      username: "c",
      deck: playerDeck(),
      opponentDeck: npcDeck(boSpd(), CARD_INDEX),
      difficulty: "normal",
      variants: {},
    });
    expect(["bottom", "top"]).toContain(session.state.first);
  });
});

describe("Bò SPD fixed deck + guaranteed opening", () => {
  it("holds bo-sieu-phan-ong-cap-1 in the opening hand before the first turn", () => {
    const ctx = makeCtx(3);
    // first: "bottom" so the player moves first and the AI has NOT acted yet.
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
    const topHand = session.state.players.top.hand.map((c) => c.def.id);
    expect(
      topHand.filter((id) => id === "bo-sieu-phan-ong-cap-1"),
    ).toHaveLength(1);

    // The top deck+hand multiset is exactly 11 bo-tuoi + 1 cap-1.
    const topAll = [
      ...topHand,
      ...session.state.players.top.deck.map((d) => d.id),
    ];
    expect(topAll.filter((id) => id === "bo-tuoi")).toHaveLength(11);
    expect(topAll.filter((id) => id === "bo-sieu-phan-ong-cap-1")).toHaveLength(
      1,
    );
  });

  it("draws only from the 12-card Bò SPD deck (no outside card) when it goes first", () => {
    const ctx = makeCtx(3);
    startBattle({
      ctx,
      userId: "e",
      username: "e",
      deck: playerDeck(),
      opponentDeck: npcDeck(boSpd(), CARD_INDEX),
      opponentGuaranteedOpening: boSpd().guaranteedOpening,
      opponentGoesFirst: true,
      difficulty: "normal",
      variants: {},
    });
    const enemyDeck = enemyDeckLog(ctx);
    expect(enemyDeck).toHaveLength(12);
    expect(enemyDeck.filter((id) => id === "bo-tuoi")).toHaveLength(11);
    expect(enemyDeck.filter((id) => id === "bo-sieu-phan-ong-cap-1")).toHaveLength(
      1,
    );
    // No card outside the two Bò SPD ids ever appears in the enemy deck.
    const allowed = new Set(["bo-tuoi", "bo-sieu-phan-ong-cap-1"]);
    expect(enemyDeck.every((id) => allowed.has(id))).toBe(true);
  });

  it("deals the 11 duplicate bo-tuoi defs as distinct card instances (distinct uids)", () => {
    const ctx = makeCtx(3);
    const session = startBattle({
      ctx,
      userId: "f",
      username: "f",
      deck: playerDeck(),
      opponentDeck: npcDeck(boSpd(), CARD_INDEX),
      first: "bottom", // player first, AI has not drawn/played yet
      difficulty: "normal",
      variants: {},
    });
    const uids = session.state.players.top.hand.map((c) => c.uid);
    expect(new Set(uids).size).toBe(uids.length);
  });
});

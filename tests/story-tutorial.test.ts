import { describe, expect, it } from "vitest";
import { tutorialLineFor, TUTORIAL_INTRO_LINE } from "../src/story/tutorial";
import type { BattleBeat, BattlePhase } from "../src/discord/battle-session";
import { createPlayer, type Player } from "../src/game/player";

/** A player sitting mid-tutorial: a story with empty teach-once flags. */
function tutorialPlayer(): Player {
  const player = createPlayer("t");
  player.story = {
    node: "cave_battle",
    name: "Abyss Eyes",
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
    tutorial: {},
  };
  return player;
}

/** A fake beat; only `phase` + `session.opponentName` are read by tutorialLineFor. */
function beat(phase: BattlePhase, opponentName = "Bò SPD"): BattleBeat {
  return {
    phase,
    session: { opponentName } as BattleBeat["session"],
    interaction: null,
    reanchor: async () => {},
  };
}

describe("tutorialLineFor — teach-once content selection", () => {
  it("teaches each lesson the FIRST time, then stays silent on repeat (teach-once)", () => {
    const cases: Array<{ phase: BattlePhase; flag: string }> = [
      { phase: "battle-start", flag: "goal" },
      { phase: "after-enemy-turn", flag: "tideSeen" },
      { phase: "after-player-play", flag: "play" },
      { phase: "after-push", flag: "push" },
      { phase: "after-player-end-turn", flag: "endTurn" },
    ];
    for (const { phase, flag } of cases) {
      const player = tutorialPlayer();
      const first = tutorialLineFor(beat(phase), player);
      expect(first, `${phase} should teach on first fire`).not.toBeNull();
      expect(first!.length).toBeGreaterThan(0);
      expect(
        (player.story!.tutorial as Record<string, boolean>)[flag],
        `${phase} should set the ${flag} flag`,
      ).toBe(true);
      // Second fire of the same beat: silent.
      expect(tutorialLineFor(beat(phase), player)).toBeNull();
    }
  });

  it("returns null for before-finish and unrelated/optional beats", () => {
    const player = tutorialPlayer();
    for (const phase of [
      "before-finish",
      "tide-shifted",
      "near-win",
      "near-defeat",
    ] as BattlePhase[]) {
      expect(tutorialLineFor(beat(phase), player)).toBeNull();
    }
  });

  it("interpolates the opponent name from the session", () => {
    const player = tutorialPlayer();
    const lines = tutorialLineFor(beat("battle-start", "Bò SPD"), player);
    expect(lines!.some((l) => l.includes("Bò SPD"))).toBe(true);
  });

  it("falls back to a literal opponent name when the session has none", () => {
    const player = tutorialPlayer();
    const b = beat("battle-start");
    (b.session as { opponentName?: string }).opponentName = undefined;
    const lines = tutorialLineFor(b, player);
    expect(lines!.some((l) => l.includes("Bò SPD"))).toBe(true);
  });

  it("teaches a lesson only once even across many repeated beats", () => {
    const player = tutorialPlayer();
    expect(tutorialLineFor(beat("after-push"), player)).not.toBeNull();
    for (let i = 0; i < 5; i++)
      expect(tutorialLineFor(beat("after-push"), player)).toBeNull();
  });

  it("mentions The Tide (never 'balance') in the goal lesson", () => {
    const player = tutorialPlayer();
    const lines = tutorialLineFor(beat("battle-start"), player)!;
    const joined = lines.join(" ");
    expect(joined).toMatch(/The Tide/);
    expect(joined).not.toMatch(/balance/i);
  });

  it("exports a reassurance intro line", () => {
    expect(TUTORIAL_INTRO_LINE).toMatch(/teach thee/i);
  });
});

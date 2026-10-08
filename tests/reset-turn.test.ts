import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { battleCommand } from "../src/discord/commands/battle";
import { setBattleStepDelay, sessions } from "../src/discord/battle-session";
import { forfeit } from "../src/engine/rules";
import { setFetchAvatar } from "../src/render/avatar";
import {
  buttonInteraction,
  lastPayload,
  makeCtx,
  rows,
  selectInteraction,
  slashInteraction,
} from "./discord-helpers";

type Ctx = ReturnType<typeof makeCtx>;

const customIdOf = (payload: any): string =>
  rows(payload)[2].components[0].custom_id;

async function start(ctx: Ctx, userId = "u1", difficulty = "normal") {
  const interaction = slashInteraction(userId, { difficulty });
  await battleCommand.execute(interaction as never, ctx);
  const payload = interaction.reply.mock.calls[0][0] as any;
  return { payload, id: customIdOf(payload).split(":")[1] };
}

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

async function pick(ctx: Ctx, userId: string, id: string, uid: string) {
  const interaction = selectInteraction(userId, `battle:${id}:pick`, [uid]);
  await battleCommand.component!(interaction as never, ctx);
  return interaction;
}

/** The first option in the card menu the player can afford right now, if any. */
const affordable = (payload: any) =>
  rows(payload)[0].components[0].options.find(
    (o: any) => !o.label.includes("Too expensive"),
  );

/** The action row's buttons, keyed by label, for the latest frame. */
function actionButtons(payload: any) {
  const components = rows(payload)[2].components;
  return Object.fromEntries(components.map((c: any) => [c.label, c]));
}

/** Starts a battle, cycling seeds until the opening hand has an affordable card. */
async function startWithPlayableCard(userId = "u1") {
  for (let seed = 1; seed <= 60; seed++) {
    const ctx = makeCtx(seed);
    const started = await start(ctx, userId);
    if (affordable(started.payload)) return { ctx, ...started };
  }
  throw new Error("no seed gave a playable opening hand");
}

describe("reset turn", () => {
  beforeEach(() => {
    setBattleStepDelay(0);
    setFetchAvatar(async () => null);
  });
  afterEach(() => setFetchAvatar());

  it("restores the exact pre-turn snapshot and does not re-run the AI", async () => {
    const { ctx, payload, id } = await startWithPlayableCard();
    const session = sessions.get("u1")!;
    // The snapshot and turn-start log captured when control reached the human.
    const snapshot = structuredClone(session.turnSnapshot!);
    const startLog = [...session.turnStartLog!];

    // Reset is disabled before any play.
    expect(actionButtons(payload)["Reset turn"].disabled).toBe(true);

    const option = affordable(payload);
    await pick(ctx, "u1", id, option.value);
    const played = await press(ctx, "u1", id, "lane", "1");
    const afterPlay = lastPayload(played.update);

    // The play changed the board/hand/energy, so Reset is now enabled.
    expect(actionButtons(afterPlay)["Reset turn"].disabled).toBe(false);
    expect(session.state).not.toEqual(snapshot);

    const click = await press(ctx, "u1", id, "reset");
    // State is restored wholesale to the snapshot.
    expect(session.state).toEqual(snapshot);
    expect(session.state.players.bottom.hand).toEqual(
      snapshot.players.bottom.hand,
    );
    expect(session.state.players.bottom.deck).toEqual(
      snapshot.players.bottom.deck,
    );
    expect(session.state.players.bottom.energy).toBe(
      snapshot.players.bottom.energy,
    );
    expect(session.state.lanes).toEqual(snapshot.lanes);
    expect(session.state.destroyedPower).toBe(snapshot.destroyedPower);
    expect(session.state.balance).toBe(snapshot.balance);
    expect(session.state.turnsPlayed).toBe(snapshot.turnsPlayed);
    expect(session.state.nextUid).toBe(snapshot.nextUid);
    expect(session.selectedUid).toBeNull();
    expect(session.log).toEqual(startLog);
    // The AI was not re-run: control still sits with the human, turn count unchanged.
    expect(session.state.active).toBe("bottom");
    // Reset re-renders in place and disables itself again on the restored turn.
    expect(
      actionButtons(lastPayload(click.update))["Reset turn"].disabled,
    ).toBe(true);
  });

  it("is disabled and rejects when nothing was played", async () => {
    const ctx = makeCtx(3);
    const { payload, id } = await start(ctx);
    expect(actionButtons(payload)["Reset turn"].disabled).toBe(true);
    const click = await press(ctx, "u1", id, "reset");
    expect(click.update).not.toHaveBeenCalled();
    expect(lastPayload(click.reply).content).toMatch(/Nothing to reset/);
  });

  it("canReset is false on the enemy's turn and once the game is over", async () => {
    const ctx = makeCtx(3);
    await start(ctx);
    const session = sessions.get("u1")!;

    // Enemy turn: canReset must be false.
    const enemyTurn = structuredClone(session.state);
    enemyTurn.active = "top";
    session.state = enemyTurn;
    session.turnSnapshot = structuredClone(enemyTurn);
    expect(
      session.state.active === "bottom" &&
        session.state.winner === null &&
        session.turnSnapshot !== null,
    ).toBe(false);
    const onEnemy = await press(ctx, "u1", session.id, "reset");
    expect(lastPayload(onEnemy.reply).content).toMatch(/Nothing to reset/);

    // Game over: canReset must be false.
    session.state = forfeit(enemyTurn, "bottom").state;
    expect(session.state.winner).not.toBeNull();
    const overClick = await press(ctx, "u1", session.id, "reset");
    expect(lastPayload(overClick.reply).content).toMatch(/Nothing to reset/);
  });
});

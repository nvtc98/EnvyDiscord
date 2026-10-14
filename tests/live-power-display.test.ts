import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderBattle, type BattleScreen } from "../src/discord/battle-view";
import { instancePower } from "../src/engine/rules";
import { createImageRenderer } from "../src/render/renderer";
import { def, emptyGame, instance } from "./engine-helpers";

const REAL_ASSETS = join(__dirname, "..", "assets");

/** A plain 4-power card used both in hand and on the board. */
const CARD = def("live-power-probe", 3, 4);

/** The pick-menu options and the "Your hand" field, read out of a rendered battle screen. */
function handViews(screen: BattleScreen) {
  const rendered = renderBattle(screen);
  const row = rendered.components[0] as any;
  const options = row.toJSON().components[0].options as { label: string }[];
  const field = rendered.embeds[0]
    .toJSON()
    .fields!.find((f) => f.name === "Your hand")!;
  return { optionLabels: options.map((o) => o.label), handField: field.value };
}

describe("current power in battle displays (regression)", () => {
  it("instancePower adds bonus and floors at 0", () => {
    expect(instancePower(instance(CARD, "bottom", 4))).toBe(8); // 4 + 4
    expect(instancePower(instance(CARD, "bottom", 0))).toBe(4);
    expect(instancePower(instance(CARD, "bottom", -10))).toBe(0); // floored, not -6
  });

  it("the pick-menu label and hand list show def.power + bonus, not the base power", () => {
    const state = emptyGame("bottom");
    // A Phoenix-style rebirth leaves the card in hand with a +4 bonus; its current power is 8.
    const buffed = instance(CARD, "bottom", 4);
    state.players.bottom.hand = [buffed];
    state.players.bottom.energy = 9;

    const screen: BattleScreen = {
      id: "t",
      state,
      viewer: "bottom",
      selectedUid: null,
      log: [],
    };
    const { optionLabels, handField } = handViews(screen);

    // Effective power (8) is shown, not the base def.power (4).
    expect(optionLabels[0]).toContain("power 8");
    expect(optionLabels[0]).not.toContain("power 4");
    expect(handField).toContain("power 8");
    expect(handField).not.toContain("power 4");
  });

  it("the battle image hand render consumes the card's bonus (buffed vs base differ)", async () => {
    const renderer = await createImageRenderer({ assetsDir: REAL_ASSETS });

    const base = emptyGame("bottom");
    base.players.bottom.hand = [instance(CARD, "bottom", 0)];
    base.players.bottom.energy = 9;

    const buffed = emptyGame("bottom");
    buffed.players.bottom.hand = [instance(CARD, "bottom", 4)];
    buffed.players.bottom.energy = 9;

    // The only difference between the two states is the hand card's bonus, so if the renderer passed
    // the base power regardless of bonus the images would be byte-identical. They must differ: the
    // buffed hand card renders its current power (8, in green) instead of the base 4.
    const baseImg = await renderer.battle({ state: base, viewer: "bottom" });
    const buffedImg = await renderer.battle({
      state: buffed,
      viewer: "bottom",
    });
    expect(buffedImg.equals(baseImg)).toBe(false);
  });
});

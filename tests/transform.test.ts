import { describe, expect, it } from "vitest";
import { CARD_INDEX } from "../src/data/cards";
import { playCard } from "../src/engine/rules";
import type { GameEvent, LaneIndex } from "../src/engine/types";
import { def, emptyGame, give, instance, setLane } from "./engine-helpers";

const C1 = () => CARD_INDEX.get("bo-sieu-phan-ong-cap-1")!;
const C2 = () => CARD_INDEX.get("bo-sieu-phan-ong-cap-2")!;
const C3 = () => CARD_INDEX.get("bo-sieu-phan-ong-cap-3")!;

/** A card that destroys an enemy by pushing into an occupied column entry cell. */
const pusher = () => def("pusher", 1, 1);

describe("transformAt", () => {
  it("does not transform while the match tally is below the threshold", () => {
    const state = emptyGame();
    state.destroyedCount = 0;
    setLane(state, 0, [instance(C1(), "top"), null, null]);
    // A play into an empty lane destroys nothing but still sweeps; the Cấp 1 must stay Cấp 1.
    state.players.bottom.energy = 1;
    give(state, "bottom", pusher());
    const uid = state.players.bottom.hand[0].uid;
    const { state: after } = playCard(state, uid, 1 as LaneIndex);
    const cap1 = after.lanes[0][0];
    expect(cap1?.def.id).toBe("bo-sieu-phan-ong-cap-1");
  });

  it("transforms Cấp 1 → Cấp 2 in place when a card is destroyed, preserving position/uid/owner and resetting bonus", () => {
    const state = emptyGame();
    // Put a Cấp 1 (top-owned) with a stale bonus elsewhere on the board.
    const cap1 = instance(C1(), "top", 5);
    setLane(state, 1, [cap1, null, null]);
    // Lane 0 is full of bottom cards; the top play enters cell 0 and pushes the whole column toward
    // the far edge, so the card at cell 2 (the victim) falls off and is destroyed.
    setLane(state, 0, [
      instance(def("a", 1, 1), "bottom"),
      instance(def("b", 1, 1), "bottom"),
      instance(def("victim", 1, 3), "bottom"),
    ]);

    // Make it the top seat's turn and give them a card to play into lane 0.
    state.active = "top";
    state.players.top.energy = 1;
    give(state, "top", pusher());
    const uid = state.players.top.hand[0].uid;

    const before = { uid: cap1.uid, owner: cap1.owner, lane: 1, pos: 0 };
    const { state: after, events } = playCard(state, uid, 0 as LaneIndex);

    expect(after.destroyedCount).toBe(1);
    const transformed = after.lanes[1][0];
    expect(transformed?.def.id).toBe("bo-sieu-phan-ong-cap-2");
    expect(transformed?.uid).toBe(before.uid); // same instance
    expect(transformed?.owner).toBe(before.owner);
    expect(transformed?.bonus).toBe(0); // bonus reset

    const ev = events.find(
      (e): e is Extract<GameEvent, { type: "transformed" }> =>
        e.type === "transformed",
    );
    expect(ev).toBeDefined();
    expect(ev?.from.id).toBe("bo-sieu-phan-ong-cap-1");
    expect(ev?.into.id).toBe("bo-sieu-phan-ong-cap-2");
    expect(ev?.uid).toBe(before.uid);
  });

  it("advances only one level per triggering action (Cấp 1 does not jump to Cấp 3 in one sweep)", () => {
    const state = emptyGame();
    // Tally already at 2, so Cấp 1 is eligible for both thresholds, but one sweep only steps once.
    const cap1 = instance(C1(), "top");
    setLane(state, 1, [cap1, null, null]);
    setLane(state, 0, [
      instance(def("a", 1, 1), "bottom"),
      instance(def("b", 1, 1), "bottom"),
      instance(def("victim", 1, 3), "bottom"),
    ]);
    state.destroyedCount = 1; // after the push below it becomes 2
    state.active = "top";
    state.players.top.energy = 1;
    give(state, "top", pusher());
    const uid = state.players.top.hand[0].uid;
    const { state: after } = playCard(state, uid, 0 as LaneIndex);
    expect(after.destroyedCount).toBe(2);
    // Cấp 1 → Cấp 2 this sweep (not Cấp 3), because the swapped cell is not revisited.
    expect(after.lanes[1][0]?.def.id).toBe("bo-sieu-phan-ong-cap-2");
  });

  it("the final level (balanceCoefficient 3) never transforms", () => {
    const state = emptyGame();
    const cap3 = instance(C3(), "top");
    setLane(state, 1, [cap3, null, null]);
    setLane(state, 0, [
      instance(def("a", 1, 1), "bottom"),
      instance(def("b", 1, 1), "bottom"),
      instance(def("victim", 1, 3), "bottom"),
    ]);
    state.active = "top";
    state.players.top.energy = 1;
    give(state, "top", pusher());
    const uid = state.players.top.hand[0].uid;
    const { state: after } = playCard(state, uid, 0 as LaneIndex);
    expect(after.destroyedCount).toBe(1);
    expect(after.lanes[1][0]?.def.id).toBe("bo-sieu-phan-ong-cap-3");
  });

  it("a Phoenix revive does not bump destroyedCount, so it does not trigger a transform", () => {
    const state = emptyGame();
    const phoenix = def("phoenix", 4, 4, {
      timing: "onDestroy",
      effect: { kind: "rebirth", amount: 4 },
    });
    const cap1 = instance(C1(), "top");
    setLane(state, 1, [cap1, null, null]);
    // Lane 0 full with a bottom Phoenix at the far edge; the top play pushes it off → it revives.
    setLane(state, 0, [
      instance(def("a", 1, 1), "bottom"),
      instance(def("b", 1, 1), "bottom"),
      instance(phoenix, "bottom"),
    ]);
    state.active = "top";
    state.players.top.energy = 1;
    give(state, "top", pusher());
    const uid = state.players.top.hand[0].uid;
    const { state: after } = playCard(state, uid, 0 as LaneIndex);
    expect(after.destroyedCount).toBe(0); // revive is not a destruction for the tally
    expect(after.lanes[1][0]?.def.id).toBe("bo-sieu-phan-ong-cap-1"); // no transform
  });
});

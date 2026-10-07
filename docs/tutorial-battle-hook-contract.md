# Integration contract — the `onBeat` battle hook (for the in-battle tutorial)

This document is a REQUEST from the story side to the battle side. The in-battle tutorial (bot talks
to the player during the first cave duel, teaching the rules as "The Tide", the 3×3 board, playing a
card, push/destroy, end turn) is **blocked on battle exposing a small hook**. The story side will NOT
touch `battle-session.ts` / `handleBattleComponent`. This file specifies exactly what battle must
expose so the story side can plug the tutorial in without any further battle changes.

Everything here is additive and OPTIONAL: a session without the hook (every `/battle` practice game,
and story battles once the tutorial is done) behaves exactly as today. Design background and the
teaching beats live in `docs/tutorial-design.md`.

> **Status: implemented (battle side).** The hook described below is built. The finalized battle-side
> API reference — exact signature, phase catalogue, re-anchor ordering, fast-path rule, ack-once
> scheme, error guarantees, and a usage sketch — is in `docs/onbeat-hook.md`. The two docs agree;
> this file remains the authoritative API request, and where any detail differs, this contract wins.

---

## What battle must provide

### 1. An optional `onBeat` callback on `Session`

Add one optional field to `Session` (`src/discord/battle-session.ts`):

```ts
export interface Session {
  // ...existing fields...
  /**
   * OPTIONAL tutorial hook. When set, the battle calls it at the beats listed below, BEFORE it
   * renders/updates the board for that beat. The callback does its own talking (it sends DM
   * messages) and then asks the battle to re-anchor the board to the bottom of the DM via the
   * `reanchor` function it is given. When unset (practice, normal story battles), battle behaves
   * exactly as today. The callback must never throw; battle may ignore a rejected promise but
   * should not crash the turn.
   */
  onBeat?: (ev: BattleBeat) => Promise<void>;
}
```

### 2. The beat event shape

```ts
export type BattlePhase =
  | "battle-start" // board just built, BEFORE the opening AI move is shown / before first player action
  | "after-player-play" // player placed one card (per play)
  | "after-push" // a push happened this action (a unit was shoved and/or destroyed)
  | "after-player-end-turn" // player pressed End, BEFORE the enemy animates
  | "after-enemy-turn" // enemy finished its animated turn
  | "tide-shifted" // the balance moved noticeably (optional; emit if cheap)
  | "near-win"
  | "near-defeat"
  | "before-finish"; // just before the end screen

export interface BattleBeat {
  session: Session; // the live session (read-only for the callback's purposes)
  phase: BattlePhase;
  /** The component interaction that triggered this beat, when there is one (null at battle-start). */
  interaction: import("discord.js").MessageComponentInteraction | null;
  /**
   * Re-anchor the board to the bottom of the DM. The callback calls this AFTER it has sent its
   * tutorial message(s). Battle: send the CURRENT board as a NEW message at the bottom of the DM,
   * record it as the live board message, then delete the PREVIOUS board message. Send-new-then-
   * delete-old (never delete-then-send) so the player never sees the board vanish. See §4.
   */
  reanchor: () => Promise<void>;
}
```

Only `battle-start`, `after-player-play`, `after-push`, `after-player-end-turn`, `after-enemy-turn`,
and `before-finish` are required. `tide-shifted` / `near-win` / `near-defeat` are nice-to-have; emit
them only if they are cheap to detect, otherwise the tutorial will manage without them.

### 3. Where battle calls the hook

At each beat, battle calls `await session.onBeat?.({ session, phase, interaction, reanchor })`
**before** it renders the board for that beat (so the tutorial line appears above the fresh board).
Concretely, in `handleBattleComponent` / the end-of-turn animation:

- `battle-start`: in `startBattle` (or right after it, wherever the first board is first shown), before showing the opening board.
- `after-player-play`: after a successful `playCard`, before the `interaction.update(renderBattle(...))`.
- `after-push`: when the play's events include a push/destroy (detectable from the engine events already computed), before the board update. May coincide with `after-player-play`; fire push first.
- `after-player-end-turn`: after `endTurn`, before the enemy animation begins.
- `after-enemy-turn`: after the enemy animation settles, before restoring controls.
- `before-finish`: in `finishBattle`, before sending the end screen — but note story battles already route end work through `session.onStoryEnd`; `before-finish` may simply be folded into the existing `onStoryEnd` call, so this one is optional if `onStoryEnd` already gives the story side its moment.

If a beat is awkward to place precisely, approximate — the tutorial tolerates a beat firing a little
early/late. The ONLY hard requirement is: when `onBeat` runs and calls `reanchor`, the board ends up
as the newest message in the DM.

### 4. The `reanchor` behavior (board always at the bottom, never vanishes)

This is the crux. Today the board is ONE message edited in place via `interaction.update`. The
tutorial needs the bot to drop one or more plain DM messages, then have the board sit BELOW them.
Discord cannot insert a message above an existing one, so the board must be re-posted at the bottom.

`reanchor()` must, in this order:

1. Send the CURRENT board (`renderBattle(await withImage(...))`, with its live components) as a **new
   message** at the bottom of the DM channel.
2. Record that new message's id as the session's live board message (so the next
   `interaction.update` / edit targets it, and the stale-button rule tracks it).
3. **Then** delete the PREVIOUS board message.

Send-new-first, delete-old-second guarantees the player always sees a board (brief moment of two
boards is fine; the old one's buttons should be stripped or it is about to be deleted anyway). Never
delete-then-send (that flashes an empty gap).

Because a re-anchored board is a normal (non-interaction) message, subsequent updates to it use
`channel.messages.edit(id, ...)` rather than `interaction.update(...)`. Battle already needs the DM
channel handle for story battles; the re-anchor path uses it. Keep using `interaction.update` on the
interaction's own message when NO tutorial line was inserted this beat (the fast, flicker-free path);
only re-anchor when the callback actually sent something. A simple contract: `reanchor` is called by
the tutorial callback ONLY when it spoke; if the callback said nothing this beat, it does not call
`reanchor`, and battle updates the board in place as it does today.

### 5. Interaction-acknowledgement note (avoid 10062/40060)

The story side already fixed a double-ack bug (`src/discord/interaction-errors.ts`). When battle both
responds to the triggering interaction AND the tutorial sends DMs + re-anchors, be careful the
interaction is acknowledged exactly once. Suggested division: the tutorial callback only sends NEW
DM messages and (via `reanchor`) sends/deletes board messages on the channel — it does NOT touch the
triggering interaction. Battle still owns the single `interaction.update`/`editReply` for that
interaction (or, when re-anchoring, battle may `interaction.deferUpdate()` to ack cheaply and then do
all board work via channel messages). Pick one and document it; the tutorial will follow.

---

## What the story side will provide (no battle work needed for this part)

Once the hook exists, the story side (in `src/discord/story-battle.ts`, which already owns
`makeOnStoryEnd` and launches the cave battle) will:

- Build an `onBeat` callback and attach it to the story battle session at launch, ONLY for the
  first cave duel (gated by a story flag so later battles and `/battle` never get it).
- Inside the callback: look at `phase`, decide what (if anything) the bot should say, send the DM
  line(s) with the existing typing+delay pacing (reusing the story DM delivery helpers), set
  per-player "already taught" flags so each lesson is said once, then call `ev.reanchor()`.
- Own all tutorial copy (archaic narration voice; plain for rule/UI explanations, per
  `.kiro/steering/voice-and-tone.md`), the "The Tide" metaphor, and the teaching order from
  `docs/tutorial-design.md`.

The battle side does NOT need to know any tutorial content, metaphor, or ordering — only to call the
hook at the beats and implement `reanchor`.

---

## Minimal acceptance checklist for the battle side

- [ ] `Session.onBeat?` optional field added; unset = today's behavior (verified: practice `/battle` unchanged).
- [ ] `BattlePhase` / `BattleBeat` types exported from `battle-session.ts` (or a shared module).
- [ ] `await session.onBeat?.(...)` called at: `battle-start`, `after-player-play`, `after-push`, `after-player-end-turn`, `after-enemy-turn` (others optional), each BEFORE that beat's board render.
- [ ] `reanchor()` implemented as send-new-board-then-delete-old, recording the new live board id; the DM never shows a boardless gap.
- [ ] Board updates after a re-anchor use `channel.messages.edit(liveId, ...)`; the no-tutorial fast path still uses `interaction.update`.
- [ ] Interaction acknowledged exactly once per press (no 10062/40060), per §5.
- [ ] A story battle with no `onBeat` set still works end-to-end (resume path included).

When these are in place, ping the story side (via the user) and the tutorial will be wired in on the
story layer with no further battle changes.

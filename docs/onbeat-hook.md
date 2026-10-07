# The battle `onBeat` hook — API reference (battle side)

This is the developer reference for the optional per-battle `onBeat` hook exposed by
`src/discord/battle-session.ts`. It documents the MECHANISM only. For WHAT the tutorial should teach
at each beat (content, metaphor, ordering of lessons) see `docs/tutorial-design.md §2`. The
authoritative consumer request this implements is `docs/tutorial-battle-hook-contract.md`; where this
doc and the contract disagree, the contract wins (they are reconciled and agree today).

Ordinary battles leave `onBeat` unset and are completely unaffected: `/battle` practice games and
story battles that do not opt in behave exactly as before. The whole feature is a single property
read per beat when `onBeat` is undefined.

## Phase catalogue

`BattlePhase` is a nine-member string union, exported from `battle-session.ts`. Each row says when it
fires. REQUIRED phases always fire at their beat; OPTIONAL phases are emitted here (they are cheap)
but a consumer must not depend on them.

| Phase                   | Req? | Fires when |
| ----------------------- | ---- | ---------- |
| `battle-start`          | yes  | Once at launch, after the first board is posted and `dm`/`boardMessageId` are set, before any other beat. Fired by the exported `runBattleStartBeat` helper the launcher calls. |
| `after-player-play`     | yes  | After the player places one card (once per placement), before the board render for that cycle. |
| `after-push`            | yes  | When a placement shoved/destroyed a unit this action: `events.some(e => e.type === "played" && e.destroyed !== null)`. Fires right after `after-player-play` for the human placement, and once per AI beat that destroyed on entry. |
| `after-player-end-turn` | yes  | After the human's own `endTurn` resolves, before the enemy animation begins. |
| `after-enemy-turn`      | yes  | Once per human End, after the enemy animation settles. Does NOT fire when the human's own endTurn ended the game, nor on a forfeit. |
| `tide-shifted`          | no   | On an end-turn-resolution beat whose shift magnitude is `>= TIDE_SHIFT_MIN` (currently 1, any non-zero shift). Only ever on end-turn beats — a card play never moves the balance. |
| `near-win`              | no   | On an end-turn-resolution beat whose post-shift `balance >= 100 - NEAR_EDGE` (currently 15), AND only while `winner === null`. |
| `near-defeat`           | no   | On an end-turn-resolution beat whose post-shift `balance <= NEAR_EDGE`, AND only while `winner === null`. |
| `before-finish`         | yes  | Once per game-over, at the top of `finishBattle` (right after the session is deleted), before rewards / `onStoryEnd` / the end screen. Reached from EVERY ending path — human-terminal endTurn, AI knockout/cap, and forfeit — so it is always the last beat of a battle. |

### `after-push` limitation

`after-push` detects destroys carried by a `played` event (`played.destroyed !== null`): a card shoved
off the far edge by a placement. Ability-driven destroys (Laser `destroyLane`, Siren `pushLane`
fall-off) surface only as `ability` prose events and are NOT detected by `after-push`. A consumer that
must react to those should diff `ev.session.state` itself. `after-push` is a best-effort
"a placement shoved/destroyed something" signal, not an exhaustive destroy signal.

### `near-*` suppression

At a knockout, `resolveTurn` clamps `balance` to exactly 100/0 and sets `winner`. The `near-*` checks
are guarded by `winner === null`, so the deciding beat is reported by `before-finish` alone, never by
`near-win`/`near-defeat` — the moment is decided, not "near".

### Firing order (one whole battle)

1. `battle-start` — once, first.
2. Per human card played: `after-player-play` → `after-push` (if that placement destroyed). No
   tide/near beats here (a play never shifts the balance).
3. On End, the human's own `endTurn` resolves first: `after-player-end-turn` → then `tide-shifted`
   and/or `near-*` if the human's own shift qualifies (near-* only while the game is undecided).
4. Then branch:
   - Human endTurn is terminal (knockout/cap): NO AI beats, `after-enemy-turn` does NOT fire; control
     goes to `finishBattle` → `before-finish`.
   - Game continues: after the enemy animation, per AI beat fire `after-push`? and (for end-turn
     beats) `tide-shifted`?/`near-*`?; then `after-enemy-turn` once; then `before-finish` if the AI
     ended the game.
5. Forfeit: no play-side beat — only `before-finish`.

## Engine change this task introduced

The engine `Beat` (`src/engine/ai-playback.ts`) gained one additive `readonly events: readonly
GameEvent[]` field, populated by `advanceAiBeats` from the per-step events it already holds. That is
what makes per-AI-beat `after-push`/`tide-shifted`/`near-*` detection exact — the flattened
`playback.events` has no per-beat boundary and must not be re-split. The engine stays pure (no I/O,
no timers); `finalState` / `events` / ordering / `rng` consumption are unchanged.

## The exported surface

All exported from `src/discord/battle-session.ts`:

```ts
export type BattlePhase =
  | "battle-start"
  | "after-player-play"
  | "after-push"
  | "after-player-end-turn"
  | "after-enemy-turn"
  | "tide-shifted"
  | "near-win"
  | "near-defeat"
  | "before-finish";

export interface BattleBeat {
  /** The live session; read-only for the callback's purposes. Read board via `session.state`. */
  session: Session;
  /** Which beat this is. */
  phase: BattlePhase;
  /** The triggering component interaction, or null (null at battle-start). Read-only context — the
   *  callback MUST NOT ack or touch it; battle owns the single ack. */
  interaction: MessageComponentInteraction | null;
  /** Re-anchor the board to the bottom of the DM. Call AFTER sending your DM, ONLY when you spoke
   *  this beat. Renders THIS beat's state, not necessarily session.state. See "Re-anchor". */
  reanchor: () => Promise<void>;
}

export type OnBeat = (ev: BattleBeat) => Promise<void>;

/** Exactly what renderBattle returns ({ embeds, components, files }). */
export type BattleBoardPayload = ReturnType<typeof renderBattle>;

export interface BattleDm {
  /** Post a fresh board; the returned id becomes the new tracked board id. */
  send(payload: BattleBoardPayload): Promise<{ id: string }>;
  /** Delete a message by id. Best-effort; benign "already gone" errors are swallowed. */
  deleteMessage(messageId: string): Promise<void>;
}
```

And on `Session` (all optional; ordinary battles leave them unset):

```ts
onBeat?: OnBeat;
boardMessageId?: string | null;
dm?: BattleDm;
```

`BattleDm` has exactly two methods and no `editMessage` — the re-anchor path never edits a board in
place; it always posts fresh and deletes the old one. `send` reuses the DM send the launcher already
uses, but `deleteMessage` is **NEW code** for this repo: it wraps `channel.messages.delete(id)`
(discord.js v14 `MessageManager#delete`), used nowhere in `src/` today. It swallows the benign
`UnknownMessage` (10008) code via the existing `isBenignEditError` / `BENIGN_EDIT_CODES` in
`src/discord/interaction-errors.ts` — the "message already gone" case a double-delete would hit.

## Re-anchor contract

`ev.reanchor()` moves the interactive board to the bottom of the DM, so the bot's chatter can sit
above it. It performs, in this DELIBERATE order:

1. No-op (resolve) when `session.dm` is undefined (ordinary `/battle`, nothing to anchor to).
2. Render the board for THIS beat's state (threaded into the closure by `runBeat`), not necessarily
   `session.state`. This matters on `after-player-end-turn`, where `session.state` has already
   advanced to the end of the AI turn while the beat is about the human's own post-shift board.
3. `send` the fresh board as a NEW message at the bottom of the DM.
4. Record that new message id as `session.boardMessageId` (the live board) — BEFORE the delete.
5. If a previous board id existed, `deleteMessage` it.

**Send-new-then-delete-old, never the reverse.** Between steps 3 and 5 the DM briefly shows two
boards; that overlap is intentional and preferred over delete-first, which would leave a boardless
gap. Do not reorder.

**Single-id invariant.** The id returned by one `dm.send` call is the single source of truth: the
battle sets `boardMessageId` to it, and the story layer's injected `send` records that same id for its
stale-button guard. They are never two different ids.

### Fast path (no auto-reanchor)

The battle NEVER auto-reanchors. `reanchor` is called by the callback ONLY when it actually spoke this
beat. If the callback says nothing, it does not call `reanchor`, and the battle updates the board in
place via `interaction.update` exactly as today — the fast, flicker-free path.

### Skip-own-render rule and ack-once

When a re-anchor happened during a handler cycle, the fresh board is already at the DM bottom, so the
battle SKIPS its own board render and acks the component cheaply:

- `handleBattleComponent` lane branch: on a re-anchor, `interaction.deferUpdate()` instead of
  `interaction.update(...)`.
- `animateEndOfTurn` / `finalRender`: on a re-anchor, the snapshot/mirror bookkeeping still runs but
  the final board send is skipped.

The callback only sends NEW DM messages and (via `reanchor`) board messages on the channel — it never
touches the triggering interaction. The battle owns the single `interaction.update` / `deferUpdate`
per press, so the interaction is acknowledged EXACTLY ONCE (avoids discord 10062 / 40060).

`before-finish` does not re-anchor (it precedes the end screen); the end screen renders normally.

## Error isolation and await guarantees

- Every beat is `await`ed, so the callback's DM send and `reanchor` fully complete before the battle
  renders the next board. Sync and async callbacks are both awaited uniformly.
- A throwing OR async-rejecting `onBeat` is caught, logged via
  `ctx.log.message("error", { battleId, phase, error })`, and swallowed — the battle continues. The
  hook is auxiliary (tutorial chatter) and must never crash a battle.
- A re-anchor whose `send` throws reports no re-anchor (the battle takes its normal render path); a
  `send` that succeeds followed by a `deleteMessage` that throws still reports a successful re-anchor
  (the new board exists) and merely leaves the stale board lingering (cosmetic).

## Usage sketch (consumer side, story layer)

```ts
// The story launcher builds the callback, closing over ctx / player / dm (like makeOnStoryEnd).
session.dm = buildBattleDm(dmChannel, player); // send records recordLive(id); deleteMessage wraps delete
session.boardMessageId = firstBoardId; // the id of the board just posted
session.onBeat = async (ev) => {
  const line = tutorialLineFor(ev.phase, player); // null if nothing to say this beat
  if (!line) return; // silent beat → fast path, no reanchor, board updates in place
  await dmChannel.sendTyping();
  await dmChannel.send({ content: line });
  await ev.reanchor(); // pull the board back below the line
};

// Launch, then fire the opening beat once dm + boardMessageId are set.
await runBattleStartBeat(ctx, session);
```

See `docs/tutorial-design.md §2` for the per-beat teaching content, and
`docs/tutorial-battle-hook-contract.md` for the authoritative API request this reference implements.

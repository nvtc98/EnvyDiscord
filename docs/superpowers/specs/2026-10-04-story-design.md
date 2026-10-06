# Story — Design

The game is a story-driven single-player game played through one command, `/story`. Card battles, collecting and deck building are parts of the story rather than separate commands.

## Goals

- One entry point: `/story` starts the story for a new player and resumes it for everyone else. The story is played in the player's direct messages with the bot, not in the server.
- Three kinds of scene: conversation and choices, a simple map, and a card duel. Conversation scenes are sent as plain DM text, one message per line, so the stranger reads like a real person typing; the map and the book's card grid keep their embed box.
- The player can leave at any moment and continue later from the same scene.
- Scenes are data plus small functions, so adding the next chapter means adding scenes, not changing the engine.
- Everything the player sees is in English, except a few special Vietnamese names such as `Bò Tuôi`.

## Command changes

| Command                                 | Change                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/story [restart]`                      | New. The story runs in the player's DMs; in a server `/story` opens the DM and replies with a short ephemeral pointer. A ready-gate (new player) or resume prompt (has progress) is shown before any scene. `restart` is owner-only and erases the owner's progress (story, collection, deck, coins, results) so the story can be replayed while testing. |
| `/invite <user>`                        | New. Any player may use it. DMs the invitee with the same ready-gate (never-played) or an invite-resume prompt (has progress), then replies to the inviter ephemerally. Reuses the story gate — it does not duplicate the flow.                                                                                                                           |
| `/battle`                               | Practice battles stay available to the **bot owner only**, so the lane battle can be tested before the story reaches its first duel. Players are told to use `/story`. Remove it once duels are part of the story.                                                                                                                                        |
| `/daily`                                | Locked until the player takes their first 12 cards in the story.                                                                                                                                                                                                                                                                                          |
| `/profile [user]`, `/collection [user]` | Gained an optional `user` option to view another player's data read-only; a never-played target reports "That player hasn't started yet." Self-view is unchanged.                                                                                                                                                                                         |
| `/admin summary [user]`                 | New. Owner-only (gated via `isOwner`). With no user, lists every known player (identity, scene, card count) with paging. With a user, shows that player's story progress and the details they entered.                                                                                                                                                    |
| `/deck`, `/card`                        | Unchanged — no other-player viewing.                                                                                                                                                                                                                                                                                                                      |
| `/shop`                                 | Now interactive: no subcommands or autocomplete. Plain `/shop` replies ephemerally with the coin balance and two buttons — summon a card and seek a new hue. The variant purchase is a two-step select flow. Game logic (prices, `buyCard`/`buyVariant`, duplicate rebate, log shapes) is unchanged.                                                      |

## Structure

```
src/story/types.ts      StoryState (saved with the player), StoryView (what one scene shows), actions, events
src/story/names.ts      cleaning typed names, adding "Eyes", matching against the list, nearest-name suggestion
src/story/prologue.ts   the scenes of the prologue: text, choices, what each choice does
src/story/engine.ts     start/resume, current view, apply a button press or a submitted form
src/game/starter.ts     the first-12-cards rule
src/discord/story-view.ts            a StoryView as Discord messages (renderPlain for conversation, renderRich for map/book)
src/discord/commands/story.ts        /story, DM delivery (incl. the battle-scene branch), the three-choice ready/resume gate, its buttons and its form
src/discord/battle-session.ts        shared battle session: map, startBattle, turn/end handling, AI advance, image render (factored out of commands/battle.ts)
src/discord/story-battle.ts          launchStoryBattle + the onStoryEnd callback (the only module importing both battle-session and the story engine/delivery)
src/render/avatar.ts                  player-avatar fetch + opponent-portrait load for the battle view
src/discord/commands/invite.ts       /invite — DMs the invitee the shared gate
src/discord/commands/admin.ts        /admin summary — owner-only player inspection
src/db/repository.ts                 PlayerRepo, including all() for enumeration
src/render/                          map and book images
```

The engine is pure: it changes a `Player` and returns the events that happened, and never touches Discord. The Discord layer saves the player, logs the events and draws the next scene.

### Scenes

A scene (`NodeDef`) has a `view` (what to show, built from the player's state so it can use their name), optional `choose` (a button was pressed: update the player, return the next scene id), optional `submit` (the scene's form was submitted) and optional `onEnter` (runs on arrival, used by the book to draw the cards).

A view has a title, lines (a speaker and text; no speaker means narration), choices (up to 5 buttons, up to 4 on a map), optionally a form, a map or a card grid. A choice may carry an `emoji` shown on its button. One stranger speaks through the whole prologue, so the Discord layer never prints his speaker label: a spoken line (one with a `speaker`) renders as plain text, and a gesture/narration line (no speaker) renders in italics. The single speaker is the `STRANGER` constant at the top of `prologue.ts`.

### State

`StoryState` is saved in `players.json` as `player.story`: the current scene, the player's name, whether they said they are one of The Eyes, whether they know the tribe's location, every name they typed (with how it matched), a pending name while they decide, a one-off notice line, the cards currently in the book with how many times it was redrawn, whether the first twelve cards were taken, and `liveMessageId` — the id of the DM message that currently carries the scene's live buttons (null in a server reply or before the first DM send). The first chapter adds three fields: `chapter` (`"bo-tuoi" | null`, set when the player is led onward so the second map's Bò Tuôi arrow is active), `battle` (a serialisable `StoryBattleState` snapshot of the running duel, or null) and `caveWon` (true once the cave duel is won, so the chapter closes and does not restart). `StoryBattleState` holds the engine `GameState` (plain, `structuredClone`-safe data), the picked card uid, the viewer-worded log, the difficulty and the opponent portrait key, so a resume can rebuild the board without re-drawing it.

### Messages and stale buttons

The story runs in the player's DM as ordinary messages, not an ephemeral in-place edit. A conversation scene is delivered as several messages — one per line — and only the last one carries the scene's buttons; the map and the book's card grid are a single embed message. In a server, `/story` opens the DM, drives the story there, and replies to the slash command with a short ephemeral pointer to the DMs; if the player's DMs are closed it replies ephemerally with an error. Ephemeral replies now exist only for these pointers, acknowledgements and owner-gated errors.

Because a scene is several messages, stale buttons are guarded by `StoryState.liveMessageId` rather than by editing one message. Advancing a scene strips the buttons off the pressed message, sends the next scene as fresh messages, and points `liveMessageId` at the new last message. A button press is stale — it only strips its own components and never advances or repeats — when its message id is not the current `liveMessageId`, or when the scene id in its custom id (`story:<scene>:c:<n>`) no longer matches the saved scene. Those two checks together mean a double click, an old message, or a stale window cannot skip or repeat a step. A submitted form is guarded the same way, resyncing to the current scene when stale.

### DM pacing (typing effect)

To make the stranger read like a real person, a conversation scene paces its lines: before each line the DM channel shows the typing indicator (`sendTyping`) and waits a delay proportional to that line's length before sending it. The delay is tuned by named constants in `story.ts` — `TYPING_MS_PER_CHAR` (per-character pace) clamped between `TYPING_MIN_MS` and `TYPING_MAX_MS`. A rich (map/book) scene is a single embed, so it shows one short typing beat and then sends once. The slash interaction is deferred/answered separately, so the pacing happens on the DM channel and never risks a 10062 "Unknown interaction".

### The duel in the DM

The first chapter runs a **real lane battle inside the story DM**, reusing the existing engine and `renderer.battle()` — the battle rules are not rewritten. The session logic is factored out of the owner `/battle` command into `src/discord/battle-session.ts` (the `sessions` map, `startBattle`, turn/end handling, AI advance, image render), shared by both entry points. A session carries an `origin`: `"practice"` (owner `/battle`, unchanged behaviour) or `"story"`. Component ids stay `battle:`-prefixed and keep routing to the one shared handler, so there is a single battle control path regardless of where the duel began.

Launching: when the story advances into `cave_battle`, the DM delivery (`deliverScene` in `story.ts`) detects the battle node and calls `launchStoryBattle` (`src/discord/story-battle.ts`) instead of the usual text/embed render. It resolves the player's deck (the just-taken twelve, so no guests), draws an opponent deck, starts a session with `origin: "story"`, `opponentPortrait: "enemy1"` and the player's avatar URL, mirrors the serialisable state onto `player.story.battle`, and sends the first battle message to the DM.

Outcome back into the story: on game over, the shared handler (for a story-origin session) deletes the session (so the reward is applied exactly once) and calls the single injected `onStoryEnd(session, outcome, interaction)` callback. That callback records the result with the usual `applyBattleResult`, calls the pure engine entry `resolveStoryBattle(player, outcome, ctx)` to move the node (win → `chapter_end`, loss → `cave_loss`), updates the finished battle message with the final board and a short in-voice caption (win: "The last card falls. The road opens."; loss: "The cards turn against thee."), and then delivers the next story scene into the same DM. A **loss** offers "take up the cards again" → `cave_battle` → a fresh battle (new shuffle, new session; the lost game is discarded). A **win** lands on the dead-end `chapter_end`. The engine stays pure — `resolveStoryBattle` only moves nodes and sets `caveWon`; coins/win-loss are recorded by the Discord layer, exactly as `/battle` does. To avoid an import cycle, the story-end handling is injected as an `onStoryEnd` callback stored on the session; only `story-battle.ts` imports both the session module and the story engine/delivery.

Persistence and resume: the in-memory session is the live source of truth, mirrored to `player.story.battle` after each action. On entering `cave_battle`, the launcher **resumes** when a saved battle exists and its game is unfinished (`state.winner === null`) — rebuilding the session from the saved `GameState` verbatim (variants recomputed from the player's cards, a new session id, the avatar re-decoded, `onStoryEnd` re-attached) and re-sending the current board — and otherwise starts a **fresh** game. A loss leaves `winner` set, so a lost snapshot never resumes; `cave_loss`'s retry also clears `player.story.battle`, so retry is unambiguously a fresh game. This keeps resuming `/story` mid-battle (or after an idle purge or a restart) safe, so a duel is never lost by leaving. Avatars (the player's Discord avatar and the opponent portrait) are added to `renderer.battle()`; the single `AvatarImage` type is declared in `src/render/avatar.ts` and imported everywhere. See the [lane-battle design](2026-10-04-lane-battle-design.md) for the avatar API and canvas placement.

### The ready-gate and resume prompts

Before any scene, `/story` and `/invite` show a short gate so the player opts in. The gate is a command-layer pre-scene, not a `NODES` scene, so declining persists nothing: the engine never starts and `player.story` stays null for a never-played player. A player with no progress sees the ready-gate; a player with progress sees a resume prompt, worded for `/story` or, from `/invite`, naming the inviter. The gate now offers **three** choices: accept, decline, and a third "to what end dost thou need me?" ask. The gate buttons are `story:gate:begin`, `story:gate:resume`, `story:gate:ask` and `story:gate:decline`; they route to the story command, which re-derives begin-vs-resume from the live `player.story` at press time (so a race cannot start twice or resume nothing). Pressing **ask** sends the stranger's in-voice answer — he must go before the Chieftain of the Bò Tuôi to beg a precious thing lent for a while, and cannot reach him alone — then **re-poses the same three choices**, so the ask loops until the player accepts or declines. Ask persists nothing (it reads the player only to pick begin-vs-resume labels when re-posing). Accept and decline keep their behaviour: declining shows a friendly line and leaves saved progress untouched (a new player stays unsaved and the next `/story` asks again). A shared `buildGate(player)` helper (returning an object `{ line, yesLabel, yesId, noLabel }`, destructured into the positional `gateMessage(line, yesLabel, yesId, noLabel)`) and a shared row builder `gateComponents(yesLabel, yesId, noLabel)` keep `/story` and `/invite` identical; `gateComponents` is the single source of the three-button layout, so `/invite` keeps its own positional `gateMessage(...)` call with its custom first line and gains the ask/decline buttons for free. When an invited player presses **ask**, the gate is re-posed via `buildGate`, which shows the standard resume/ready line rather than the invite line — intended, since the invite framing is spent after the first interaction. The exact strings live in the `GATE` object in `prologue.ts` (now including `askLabel` and `askAnswer`), kept in the stranger's direct second-person voice.

### /invite

`/invite <user>` lets any player (not just the owner) ask the bot to reach out to someone. It rejects bots and self-invites (self is pointed at `/story`), opens the target's DM, loads that player, and sends the shared gate — the ready-gate for a never-played target or the invite-resume prompt (naming the sanitized inviter) for one with progress. The inviter gets an ephemeral confirmation, or an error when the target's DMs are closed; neither reply pings. The gate buttons are the same `story:gate:*` ids, so `/invite` reuses the story command's gate handler and never duplicates the flow. Each attempt logs a `story_invite` event with the inviter, target and whether the DM succeeded.

### Viewing another player

`/profile` and `/collection` take an optional `user` option to view someone else read-only; `/deck` and `/card` are unchanged. Viewing another player loads their record and shows it under their name and avatar without ever mutating it. `/collection`'s paging buttons carry the target id (`collection:<page>:<targetId>`) so paging keeps viewing the same person, while a self-view keeps the plain `collection:<page>` id and stays backward compatible. A target that is indistinguishable from a fresh player (no story, no cards, no results, no coins — checked by `hasPlayed`) reports "That player hasn't started yet." Both views stay ephemeral.

### /admin summary

`/admin summary` is owner-only, gated by `isOwner` (the tester is the app owner, so no id is hard-coded). With no user it lists every known player — identity, current scene or "not started", and how many owned cards still exist in the card list — in an embed with `◀`/`▶` paging (`admin:<page>`), capped and chunked to stay inside Discord's limits; the paging handler re-checks `isOwner`. With a user it shows that player's story in detail: scene, name entered, whether they claimed to be one of The Eyes, whether they know the tribe, pack and starter status, the recorded name attempts, and a card count — or "hasn't started the story" when there is no progress. It never exposes `/deck`- or `/card`-level detail, and each use logs an `admin_summary` event. The player list comes from `PlayerRepo.all()`.

### PlayerRepo.all()

`PlayerRepo` gained `all(): Player[]`, returning every known player as copies in an unspecified order, for admin and inspection use. The JSON repo maps its stored ids through `get()` so the normalization is identical to a single lookup; the in-memory test repo clones each stored player.

### The shop

`/shop` is interactive and has no subcommands or autocomplete. Plain `/shop` replies ephemerally with the player's coin balance and two buttons: a mystical "summon a card" (not "buy a card") and "seek a new hue". The summon button runs the existing `buyCard` and shows the result embed + card image, handling insufficient coins and a complete collection in voice. The hue button opens a two-step string-select flow: first a select of the player's owned cards that still have a purchasable, not-yet-owned variant (capped at 25, saying so when more are eligible, or saying none await a hue), then a select of that card's purchasable variants the player does not own, which runs the existing `buyVariant` and shows the result embed + image. Rejection reasons (insufficient coins, not owned, already owned, not purchasable) are shown in voice. All component ids are `shop:`-prefixed (`shop:summon`, `shop:variant`, `shop:pickcard`, `shop:pickvariant:<cardId>`) so `index.ts` routes them to the shop command. The game logic is untouched: `buyCard`, `buyVariant`, `SHOP_CARD_PRICE`, `SHOP_VARIANT_PRICE`, `DUPLICATE_REBATE` and the `shop_card`/`shop_variant` log shapes are unchanged — this is a UI change.

### Names

The player types only the first part (the form placeholder is `Phantom`); Discord does not allow a fixed suffix inside an input box, so the form's label says "Eyes is added for thee" and the game appends it. A typed trailing "Eyes" is dropped, so `Phantom Eyes` does not become `Phantom Eyes Eyes`, and `Phantom`, `PhantomEyes` and `Phantom Eyes` all become `Phantom Eyes`. The non-Eye path takes a free name as typed and does not append "Eyes". Only letters, digits, spaces, apostrophes, dots and hyphens are kept, so a name can never carry formatting, mentions or links into later text. Words are capitalised (`ocean blue` becomes `Ocean Blue Eyes`).

Matching ignores case, accents, spaces, hyphens and apostrophes (`x ray` matches `X-Ray Eyes`) and returns the list's own spelling. When there is no exact match the nearest name (edit distance) is suggested if it is a plausible slip: at most one edit for very short names, otherwise about a third of the name's length, never fewer than two. Ties go to the alphabetically first name so the suggestion is stable. The player can accept the suggestion, say the name again, or keep what they typed. Every attempt is stored in order, and the final name is stored separately.

The name `Stranger` (normalising to `Stranger Eyes`) is reserved and hard-rejected: it is the stranger's own alias, so if the player types it they are told the name is already spoken for and must type again. Unlike an ordinary unmatched name, it is never keepable — no attempt is recorded and no pending name is set. The check reuses the matcher's normalisation (`isStrangerStem` in `names.ts`), so `Stranger`, `  stranger  ` and `stranger eyes` are all caught.

## The prologue

A single stranger meets the player on the road and stays with them to the end. He talks to the player directly in the first and second person, folding the scene around him ("Hear that wind?") into his own speech rather than a detached narrator; the rare line without a speaker is only a short stage-direction of his own gesture (e.g. "He pulls his hood lower"). His speaker label is never shown. He secretly calls himself "Stranger Eyes", a self-given alias — he is not truly one of The Eyes, which stays a hint and is never stated outright.

1. **Greeting** — "Are you one of The Eyes?" Both paths now ask for a name, but in different ways.
2. **Name (Eye path)** — form, then match against the list. An exact match is welcomed. Otherwise: suggestion (if any), then "say it again" or "keep it". The form placeholder is "Phantom"; a typed `Phantom`, `PhantomEyes` or `Phantom Eyes` all normalise to `Phantom Eyes`.
   **Name (non-Eye path)** — the stranger asks for a free name instead (no match against the list, "Eyes" is not appended), and the acknowledgement reaction differs from the Eye path. The reserved name "Stranger" is hard-rejected on both paths and the player must type again.
3. **The tribe** — "Do you know where the Bò Tuôi live?" Yes: the stranger is pleased. No and an Eye: "surely you know, point me in the right direction". No and not an Eye: "then we search together".
4. **The curse** — the tribe is cursed and cannot be approached normally. The stranger reports a **man on the inside** who can lead _us_ — bot and player together — in by the ways beneath, but his price is a duel: we must beat _him_ at cards before he opens the road. To sit at that table the player needs a deck of The Eyes of their own, and that deck lies in The Eyes Of Wisdom. (The duel is against the inside man, not the stranger himself.) The scene ends coaxing the player on to the book. The one gesture line is first person ("I draw my hood lower…"), never "He".
5. **Map** — the curse beat leads straight to the map; there is no "a figure steps out at the crossroads" beat and no second character ever appears on screen. The map shows The Eyes Of Wisdom (left), The Crossroads (here, middle), Bò Tuôi (right). Both choices share the primary style and carry arrow emojis, ⬅️ for The Eyes Of Wisdom and ➡️ for Bò Tuôi. Choosing Bò Tuôi gets "not yet" and returns to the map. (The old `informant` scene is removed; its one useful line — set the way to The Eyes Of Wisdom — folds into the map's intro, re-voiced in first person.)
6. **The Eyes Of Wisdom** — the stranger guides the way in and points to a book that gives up the deck. The player may ask "How do you know all this?"; he answers evasively, telling them to just call him "Stranger Eyes" with a knowing smile, then they go to the book. Choosing "Just open the book" skips straight to it.
7. **The book** — twelve different cards: 2 epic, 2 rare, 8 common. "Take these cards" or "Close the book and open it again" (another twelve; the stranger reacts with a different line each time). Taking the cards grants all twelve, sets them as the deck, and unlocks `/daily`.

The cards are granted only when taken, so redrawing costs nothing and the player never ends up with cards they did not choose.

## The first chapter: the cave duel

After the book is taken the prologue flows straight into the first chapter and its first real duel. The tail `book_taken → prologue_end` is replaced by a chain ending at a dead-end `chapter_end`. Every scene is the same one-voice archaic DM conversation with the typing+delay pacing; only the map and the face-reveal carry an image. The man on the inside **never speaks** — the bot reports and paraphrases him in his own voice.

1. **Praise the draw** (`deck_praise`) — the bot calls the twelve a fortunate, lucky hand.
2. **To Bò Tuôi** (`to_bo_tuoi`, map) — the bot says he will lead the player to the land of the Bò Tuôi and the map opens again; this time the ➡️ Bò Tuôi arrow is the active forward choice (⬅️ back to Wisdom gets a short "naught left there" detour, like the earlier "not yet"). On entry it sets `story.chapter = "bo-tuoi"`.
3. **Sea cliff** (`sea_cliff`) — the bot leads the player to a cliff above the sea and points to a cave mouth as the way in. (Subtext for the reader only, never stated: he already knew the way and merely lured the player along.)
4. **The curse, explained** (`curse_underground`) — the curse strikes any who set _foot_ on the Bò Tuôi's land from above; but coming up from underground through the cave, we never set foot on it, so we are spared.
5. **The cave mouth** (`cave_mouth`) — the bot greets his contact and tells him, in his own voice, that this one at his side has carried the deck the whole road; he adds a couple of ominous in-voice lines built around remarking on the man's face ("look at thy face…").
6. **The face** (`reveal_face`, portrait embed) — the scene shows the inside man's portrait, `assets/portraits/enemy1.png` (a 1:1 square), attached to a rich embed much as the map/book scenes attach their image.
7. **The terms** (`cave_terms`) — the bot relays the man's wager: lose, and the man takes the deck and the curse falls on the player; win, and the road opens. Choices: accept / refuse. Refusing (`cave_refuse`) draws a coercive "thou thinkest thou mayst refuse, here?" and re-shows the choice as accept / accept — the only way on (compulsion subtext, never explained). Either accept leads to the duel.
8. **The duel** (`cave_battle`) — a real lane battle in the DM, the player's just-earned 12-card deck versus an AI foe whose avatar is `enemy1.png` (see the battle integration below).
9. **Outcome** — **loss** (`cave_loss`) offers "take up the cards again", which re-enters a fresh battle; **win** closes the chapter with a short in-voice line (`chapter_end`, "the tale continues anon"), with no further story yet.

## Cards

The card list is `src/data/eyes-names.json` (229 names: 195 common, 19 rare, 15 epic). It has no stats, so each card gets a placeholder cost and power from its id and rarity until real values arrive. Rarity is used only by the starter pack; ordinary `/daily` packs ignore it, as before. The previous 15 placeholder cards with abilities were removed with this change; abilities will be added when they are designed (epic cards are expected to have several exclusive, complex abilities).

## Known limits

- `/deck` shows at most 25 cards (a select menu limit); browsing a larger collection needs paging.
- `/collection` shows three cards per page, which is 77 pages for the full list.
- The story runs through the first chapter's cave duel and stops at `chapter_end`; a win closes the chapter with no further story yet, a loss retries the duel.
- The map is a fixed picture per scene (three places); the format supports other layouts (places with positions and links).

## Testing

Story engine: name cleaning and matching (exact, near, none, ties, short names), the starter-pack mix over 100 seeds, every branch of the prologue (Eye or not, knows the tribe or not), name attempts recorded in order, the map and the "not yet" detour, redrawing the book many times, taking the cards, stale and invalid actions, saving and loading state, and a check that every scene fits Discord's limits. Discord flow: the DM model (a conversation scene sending one message per line with buttons on the last, the map and book as embeds, a server `/story` opening a DM and replying with an ephemeral pointer, closed DMs reporting an error), the ready-gate and resume prompts (declining a new player persists nothing and re-asks; resuming lands at the saved scene; declining a resume leaves progress untouched), `/story` beginning and resuming, the form and its settings, sanitising of hostile names, stale and non-live buttons and old forms that never advance or repeat, the whole journey through the book, `/daily` locked and then unlocked, images attached and replaced, and the owner-only restart. Also `/invite` (the shared gate reaching the invitee, closed-DM and bot/self rejections), other-player read-only `/profile` and `/collection` with the "hasn't started" message, and owner-only `/admin summary` listing all players and inspecting one.

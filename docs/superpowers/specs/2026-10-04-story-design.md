# Story — Design

The game is a story-driven single-player game played through one command, `/story`. Card battles, collecting and deck building are parts of the story rather than separate commands.

## Goals

- One entry point: `/story` starts the story for a new player and resumes it for everyone else.
- Three kinds of scene: conversation and choices, a simple map, and a card duel.
- The player can leave at any moment and continue later from the same scene.
- Scenes are data plus small functions, so adding the next chapter means adding scenes, not changing the engine.
- Everything the player sees is in English, except a few special Vietnamese names such as `Bò Tuôi`.

## Command changes

| Command                                     | Change                                                                                                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/story [restart]`                          | New. `restart` is owner-only and erases the owner's progress (story, collection, deck, coins, results) so the story can be replayed while testing.                                                                 |
| `/battle`                                   | Practice battles stay available to the **bot owner only**, so the lane battle can be tested before the story reaches its first duel. Players are told to use `/story`. Remove it once duels are part of the story. |
| `/daily`                                    | Locked until the player takes their first 12 cards in the story.                                                                                                                                                   |
| `/deck`, `/collection`, `/card`, `/profile` | Unchanged.                                                                                                                                                                                                         |

## Structure

```
src/story/types.ts      StoryState (saved with the player), StoryView (what one scene shows), actions, events
src/story/names.ts      cleaning typed names, adding "Eyes", matching against the list, nearest-name suggestion
src/story/prologue.ts   the scenes of the prologue: text, choices, what each choice does
src/story/engine.ts     start/resume, current view, apply a button press or a submitted form
src/game/starter.ts     the first-12-cards rule
src/discord/story-view.ts            a StoryView as a Discord message
src/discord/commands/story.ts        /story, its buttons and its form
src/render/                          map and book images
```

The engine is pure: it changes a `Player` and returns the events that happened, and never touches Discord. The Discord layer saves the player, logs the events and draws the next scene.

### Scenes

A scene (`NodeDef`) has a `view` (what to show, built from the player's state so it can use their name), optional `choose` (a button was pressed: update the player, return the next scene id), optional `submit` (the scene's form was submitted) and optional `onEnter` (runs on arrival, used by the book to draw the cards).

A view has a title, lines (a speaker and text; no speaker means narration), choices (up to 5 buttons, up to 4 on a map), optionally a form, a map or a card grid. A choice may carry an `emoji` shown on its button. One stranger speaks through the whole prologue, so the Discord layer never prints his speaker label: a spoken line (one with a `speaker`) renders as plain text, and a gesture/narration line (no speaker) renders in italics. The single speaker is the `STRANGER` constant at the top of `prologue.ts`.

### State

`StoryState` is saved in `players.json` as `player.story`: the current scene, the player's name, whether they said they are one of The Eyes, whether they know the tribe's location, every name they typed (with how it matched), a pending name while they decide, a one-off notice line, the cards currently in the book with how many times it was redrawn, and whether the first twelve cards were taken.

### Messages and stale buttons

The story message is private (ephemeral) and is edited in place at every step. Button ids carry the scene they belong to (`story:<scene>:c:<n>`). Pressing a button from an old message does nothing except show where the player really is, so a double click or an old window cannot skip or repeat a step. The same holds for a submitted form.

### Names

The player types only the first part (`Ocean`); Discord does not allow a fixed suffix inside an input box, so the form's label says "Eyes is added for you" and the game appends it. A typed trailing "Eyes" is dropped, so `Ocean Eyes` does not become `Ocean Eyes Eyes`. Only letters, digits, spaces, apostrophes, dots and hyphens are kept, so a name can never carry formatting, mentions or links into later text. Words are capitalised (`ocean blue` becomes `Ocean Blue Eyes`).

Matching ignores case, accents, spaces, hyphens and apostrophes (`x ray` matches `X-Ray Eyes`) and returns the list's own spelling. When there is no exact match the nearest name (edit distance) is suggested if it is a plausible slip: at most one edit for very short names, otherwise about a third of the name's length, never fewer than two. Ties go to the alphabetically first name so the suggestion is stable. The player can accept the suggestion, say the name again, or keep what they typed. Every attempt is stored in order, and the final name is stored separately.

The name `Stranger` (normalising to `Stranger Eyes`) is reserved and hard-rejected: it is the stranger's own alias, so if the player types it they are told the name is already spoken for and must type again. Unlike an ordinary unmatched name, it is never keepable — no attempt is recorded and no pending name is set. The check reuses the matcher's normalisation (`isStrangerStem` in `names.ts`), so `Stranger`, `  stranger  ` and `stranger eyes` are all caught.

## The prologue

A single stranger meets the player on the road and stays with them to the end. He talks to the player directly in the first and second person, folding the scene around him ("Hear that wind?") into his own speech rather than a detached narrator; the rare line without a speaker is only a short stage-direction of his own gesture (e.g. "He pulls his hood lower"). His speaker label is never shown. He secretly calls himself "Stranger Eyes", a self-given alias — he is not truly one of The Eyes, which stays a hint and is never stated outright.

1. **Greeting** — "Are you one of The Eyes?" Yes goes to the name; No skips it (the story does not change).
2. **Name** (Yes only) — form, then match. An exact match is welcomed. Otherwise: suggestion (if any), then "say it again" or "keep it". Typing the reserved name "Stranger" is hard-rejected and the player must type again.
3. **The tribe** — "Do you know where the Bò Tuôi live?" Yes: the stranger is pleased. No and an Eye: "surely you know, point me in the right direction". No and not an Eye: "then we search together".
4. **The curse** — the tribe is cursed and cannot be approached normally. The stranger himself is the insider who can bring the player in safely; his price is a duel — beat him at cards and he brings you in — but to challenge him you need a deck of The Eyes of your own, and that deck lies in The Eyes Of Wisdom.
5. **The crossroads** — the same stranger reaches the crossroads and sets the way to The Eyes Of Wisdom.
6. **Map** — The Eyes Of Wisdom (left), The Crossroads (here, middle), Bò Tuôi (right). Both choices share the primary style and carry arrow emojis, ⬅️ for The Eyes Of Wisdom and ➡️ for Bò Tuôi. Choosing Bò Tuôi gets "not yet" and returns to the map.
7. **The Eyes Of Wisdom** — the stranger guides the way in and points to a book that gives up the deck. The player may ask "How do you know all this?"; he answers evasively, telling them to just call him "Stranger Eyes" with a knowing smile, then they go to the book. Choosing "Just open the book" skips straight to it.
8. **The book** — twelve different cards: 2 epic, 2 rare, 8 common. "Take these cards" or "Close the book and open it again" (another twelve; the stranger reacts with a different line each time). Taking the cards grants all twelve at frame tier 1, sets them as the deck, and unlocks `/daily`.
9. **End of the prologue** — "The story continues soon."

The cards are granted only when taken, so redrawing costs nothing and the player never ends up with cards they did not choose.

## Cards

The card list is `src/data/eyes-names.json` (229 names: 195 common, 19 rare, 15 epic). It has no stats, so each card gets a placeholder cost and power from its id and rarity until real values arrive. Rarity is used only by the starter pack; ordinary `/daily` packs ignore it, as before. The previous 15 placeholder cards with abilities were removed with this change; abilities will be added when they are designed (epic cards are expected to have several exclusive, complex abilities).

## Known limits

- `/deck` shows at most 25 cards (a select menu limit); browsing a larger collection needs paging.
- `/collection` shows three cards per page, which is 77 pages for the full list.
- The story ends at the prologue; the stranger's duel is next.
- The map is a fixed picture per scene (three places); the format supports other layouts (places with positions and links).

## Testing

Story engine: name cleaning and matching (exact, near, none, ties, short names), the starter-pack mix over 100 seeds, every branch of the prologue (Eye or not, knows the tribe or not), name attempts recorded in order, the map and the "not yet" detour, redrawing the book many times, taking the cards, stale and invalid actions, saving and loading state, and a check that every scene fits Discord's limits. Discord flow: `/story` beginning and resuming, the form and its settings, sanitising of hostile names, old buttons and old forms, the whole journey through the book, `/daily` locked and then unlocked, images attached and replaced, and the owner-only restart.

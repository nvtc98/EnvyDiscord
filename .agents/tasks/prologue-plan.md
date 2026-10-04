# Implementation Plan — Single-stranger prologue rewrite

Context for the implementer (read before starting):

- Shell quirk: the interactive zsh init is broken and garbles `npm run ...`. Invoke binaries directly from the repo root:
  - Typecheck: `./node_modules/.bin/tsc --noEmit`
  - Tests: `./node_modules/.bin/vitest run` (whole suite) or `./node_modules/.bin/vitest run tests/story.test.ts tests/story-flow.test.ts` (the two story suites).
- Baseline (confirmed before this task): `tsc --noEmit` passes clean. `vitest run` has exactly **two pre-existing failures unrelated to this task**: `tests/commands.test.ts` (expects command list without `shop`) and `tests/commands-flow.test.ts > /profile` (`displayAvatarURL is not a function`). Do NOT try to fix these; just confirm the count does not grow and no story test regresses.
- Decision — one speaker: the task fixes GUIDE+INFORMANT into ONE character. Chosen approach: a single `STRANGER` constant + single `stranger(text)` helper, label hidden at render time. Rationale: the task mandates it, and a single speaker lets `story-view.ts` simply stop printing the bold label for spoken lines.
- Decision — voice: rewrite every line as the stranger talking to "you" in first/second person, folding environment description into his speech. Remaining `narration(...)` lines become short italic gesture beats of HIS own action (e.g. "He pulls his hood lower"), used sparingly. Keep English; keep the Vietnamese proper name `Bò Tuôi`.
- Decision — curse/merge coherence: there is no separate insider anymore. The single stranger IS the insider who brings you in. Preserve the meaning of the recently-reworded curse line: his price is a duel, beat him at cards and he brings you in safely, and to challenge him you need a deck of The Eyes of your own; that deck is in The Eyes Of Wisdom. Reframe the `informant` scene (currently "a figure steps out...") as a continuation of the same stranger, not a new arrival.
- Decision — "Stranger Eyes": a self-given alias; he is NOT truly one of The Eyes. Informs tone only (evasive/mysterious); never stated outright in-fiction.

---

- [x] 1. Add `emoji?: string` to the `StoryChoice` type and render it on buttons.
     The recent map edit added `emoji: "⬅️"` / `emoji: "➡️"` to choices, but `StoryChoice` has no `emoji` field and `story-view.ts` never calls `.setEmoji`, so the arrows do not currently show. Add `emoji?: string` to the `StoryChoice` interface in types.ts, and in `renderStory` call `.setEmoji(choice.emoji)` on the choice button when `choice.emoji` is set (guard with `if (choice.emoji)`).
     Files: src/story/types.ts, src/discord/story-view.ts
     Verify: `./node_modules/.bin/tsc --noEmit` passes; `./node_modules/.bin/vitest run tests/story-flow.test.ts` still passes (the map/journey test must stay green).

- [x] 2. Suppress the speaker-name label when rendering spoken lines.
     In `formatLine` in story-view.ts, stop printing the bold `**speaker**` header. Since there is now a single stranger, every spoken line renders as plain text and gesture/narration lines stay italic. Change `formatLine` so a line with a `speaker` renders just `line.text` (no bold name), and a line without a speaker stays `*italic*`. Keep the `StoryLine.speaker` field in types.ts intact (still used to distinguish speech from gesture, and by tests/engine).
     Files: src/discord/story-view.ts
     Verify: `./node_modules/.bin/tsc --noEmit` passes. (Behavioral check happens via the updated tests in later items; this item leaves the build green.)

- [x] 3. Collapse the two speaker constants/helpers into one stranger speaker in prologue.ts.
     Replace `export const GUIDE`/`export const INFORMANT` with a single `export const STRANGER = "Stranger"` (exported name is internal; it is no longer rendered, so the exact string only matters to any test that references `.speaker`). Replace the two helpers `guide`/`informant` with one `const stranger = (text) => ({ speaker: STRANGER, text })`. Keep `narration` for gesture beats. Do NOT yet rewrite the prose — in this item only mechanically swap every `guide(...)` and `informant(...)` call to `stranger(...)` so the file still compiles. (Prose rewrite is item 5.)
     First grep for cross-repo imports of `GUIDE`/`INFORMANT`: none exist outside prologue.ts (confirmed — only prologue.ts and tests reference the speaker strings), so no other source file needs updating. Keep `TRIBE` and `PLACE_WISDOM` exports unchanged (tests import them).
     Files: src/story/prologue.ts
     Verify: `./node_modules/.bin/tsc --noEmit` passes.

- [x] 4. Add the new "ask how you know" scene nodes inside The Eyes Of Wisdom and rewire `wisdom` into them before the book.
     Currently `wisdom.choose` returns `"book"`. Insert a beat: when the player enters The Eyes Of Wisdom the stranger gives a few guiding lines and offers a choice to ask "How do you know all this?" plus a way to continue straight to the book. On asking, he answers evasively — tell the player to just call him "Stranger Eyes", with a short knowing-smile gesture beat — WITHOUT revealing he isn't truly one of The Eyes. Then route to `book`.
     Concretely: keep the `wisdom` node as the arrival beat but change its choices to two: e.g. `{ label: "How do you know all this?", style: "primary" }` and `{ label: "Just open the book", style: "secondary" }`. `wisdom.choose` returns the new `wisdom_ask` node for index 0 and `"book"` for index 1. Add a new node `wisdom_ask` whose `view` shows the evasive "call me Stranger Eyes" answer (a `stranger(...)` line plus a short `narration("He smiles, and does not answer the rest.")`-style gesture) and a single `go("Open the book")` choice; its `choose` returns `"book"`. Do NOT add `onEnter`/`showPack` to the new nodes — the book's `onEnter` (which calls `showPack`) must remain only on the `book` node so the pack is drawn exactly once on entry to `book`. Verify the engine's `onEnter` fires on arrival at `book` from either path (it does: `applyAction` calls `NODES[next].onEnter` whenever `next !== current`).
     Files: src/story/prologue.ts
     Verify: `./node_modules/.bin/tsc --noEmit` passes; after item 8's test is added, `./node_modules/.bin/vitest run tests/story.test.ts` passes (routing wisdom → wisdom_ask → book and wisdom → book both reach the book with a drawn pack).

- [x] 5. Rewrite every prologue line into the single-stranger, direct second-person voice.
     Go scene by scene in prologue.ts and rewrite the text of each `stranger(...)` / `narration(...)` line per the voice decision above. Keep the scene graph, node ids, choices (labels/styles/emojis), form fields, and all control flow EXACTLY as they are; only the line text changes. Scene-by-scene intent:
     - `greeting`: fold the "cold wind / empty road / been waiting" setting into the stranger's own speech; keep the "are you one of The Eyes?" question and the two choices unchanged.
     - `ask_name`: keep the form and its labels; reword the two lead-in lines as his speech.
     - `name_exact` / `confirm_name` / `name_confirmed` / `not_eye`: reword as his speech; keep the `${story(p).name}` / `${pending.typed}` / `${pending.suggestion}` interpolations and the confirm choice labels (`Yes, I am ...`, `I will say it again`) UNCHANGED — tests assert those labels and the welcome text containing the name.
     - `tribe` / `tribe_known` / `tribe_unknown_eye` / `tribe_unknown_stranger`: keep `${TRIBE}`; keep the phrases the tests match: `tribe` view must still contain "Do you know where they live" (story-flow.test asserts `/Do you know where they live\?/`), `tribe_unknown_eye` must still contain "you are one of The Eyes. Surely you know", `tribe_unknown_stranger` first line must still match `/search together/`.
     - `curse`: preserve the recently-reworded meaning (duel → beat him at cards → he brings us in safely → need a deck of The Eyes of your own → deck is in The Eyes Of Wisdom), but reframed as the SAME stranger speaking (he is the insider). Must still contain `${TRIBE}` (and literal "Bò Tuôi"), the word matching `/strange curse/`, and `${PLACE_WISDOM}` — tests assert all three.
     - `informant`: reframe from "a figure steps out from behind a dead tree" (a new arrival) into a continuation of the same stranger at the crossroads (e.g. a short gesture beat about reaching the crossroads, then his line). Keep the `go("Look at the map")` choice and title `CROSSROADS`.
     - `map`: keep `stranger("Where shall we go?")` (reworded is fine) and the TWO choices with styles `primary` and emojis `⬅️`(PLACE_WISDOM) / `➡️`(TRIBE) EXACTLY — this is a required recent edit to preserve. Keep the map locations/links.
     - `map_not_yet`: reword; keep it matching `/Not yet/` (test asserts). Keep `go("Back to the map", "secondary")`.
     - `wisdom` + `wisdom_ask` (from item 4): the arrival lines guiding the way in, and the evasive "Stranger Eyes" answer. `wisdom` must still contain text matching `/there is a book/` (story-flow.test asserts `expect(text(p)).toMatch(/there is a book/)` on the Wisdom scene) — keep that phrase in the `wisdom` arrival lines.
     - `book`: keep the `${who(p)}` interpolation and the two choices (`Take these cards`, `Close the book and open it again`) UNCHANGED (tests assert these labels); reword the single line as his speech.
     - `REROLL_LINES`: reword all four as his speech (they are shown as `s.notice` on reopen). After the label suppression they render as plain text; keep them as `stranger(...)` lines so `.speaker` stays set (story.test asserts `first.speaker` — see item 8 for the updated expectation).
     - `book_taken`: keep the `${STARTER_SIZE}` interpolation and the gesture about cards settling into hands (test asserts `/settle into your hands/`); reword his follow-up line.
     - `prologue_end`: keep `${TRIBE}`; reword; keep the final `narration(...)` matching `/The story continues soon/` (story-flow.test asserts it). Keep empty `choices: []`.
       Files: src/story/prologue.ts
       Verify: `./node_modules/.bin/tsc --noEmit` passes; run the story suites after items 6-8 update expectations: `./node_modules/.bin/vitest run tests/story.test.ts tests/story-flow.test.ts`.

- [x] 6. Add a hard block for the name "Stranger" / "Stranger Eyes" in the `ask_name` submit handler.
     In `ask_name.submit` in prologue.ts, after `cleanStem(text)` and before (or alongside) `matchName`, detect when the cleaned stem normalizes to "stranger" and reject it hard: set `s.notice` to a dedicated `stranger(...)` rejection line, do NOT push a name attempt, do NOT set `pendingName`, and `return "ask_name"` so the player must type again (never keepable — unlike the normal unmatched flow). Use the SAME normalization the matcher uses for consistency: `names.ts` has a module-private `normalize` and `stemOf`. Export a small reusable helper from names.ts rather than duplicating the regex — add `export const isStrangerStem = (stem: string): boolean => normalize(stem.replace(/\s+eyes$/i, '')) === 'stranger'` (reuse the existing `normalize`; it already strips case/accents/spaces/punctuation so "stranger", "Stranger", " stranger ", "stranger eyes" all match after cleanStem drops a trailing "Eyes"). Call `cleanStem` first (as the handler already does), then `isStrangerStem(stem)`. The rejection line should be a short, in-fiction easter-egg hint that the name belongs to someone else / is already taken (do not reveal the alias is his own). Place the check after the empty-stem guard so an empty name still gets the "cannot be empty" notice.
     Files: src/story/names.ts, src/story/prologue.ts
     Verify: `./node_modules/.bin/tsc --noEmit` passes; `./node_modules/.bin/vitest run tests/story.test.ts tests/story-flow.test.ts` passes after item 8 adds the rejection tests.

- [x] 7. Update the story design doc to reflect the merge, the new beat, the name block, and the arrows.
     Edit docs/superpowers/specs/2026-10-04-story-design.md: in the prologue section replace the two-character description (Guide + Informant) with the single stranger who speaks directly to the player and whose label is hidden; note he calls himself "Stranger Eyes" as a self-given alias and is not truly one of The Eyes; describe the new "ask how he knows" beat in The Eyes Of Wisdom before the book; note the map's two choices share the primary style with ⬅️ / ➡️ arrows; note that typing "Stranger" as a name is hard-rejected and not keepable. Update the "### Scenes" note that says "Speaker names are constants at the top of prologue.ts" to reflect the single hidden speaker. Keep the rest of the doc intact.
     Files: docs/superpowers/specs/2026-10-04-story-design.md
     Verify: re-read the changed sections and confirm they match the implemented behavior (doc-only change; no build impact).

- [x] 8. Update and extend the tests for the new voice, hidden label, new scene, and name block.
     Update existing assertions that depend on the old two speakers, and add new coverage without weakening existing coverage. Specifically:
     - tests/story-flow.test.ts line ~105: the regex `expect(text(update).replace(/\*\*Guide\*\*/g, '')).not.toContain('*')` assumed a bold `**Guide**` label. Since the label is now hidden, there are no bold speaker labels; update this to assert the sanitized name text is present and no stray markdown/mention characters leaked, without stripping a label that no longer exists (e.g. drop the `.replace(...)` and assert the text contains `Bold Everyone 123 Xhttpevil Eyes` and does not match `/[@<>\[\]]|:\/\//`). Keep the sanitisation intent.
     - tests/story-flow.test.ts line ~177: `expect(text(again)).toContain('The Informant')` on reopening the book — the label is gone, so assert on the reroll line's TEXT instead (match a distinctive phrase from the reworded `REROLL_LINES`), or assert the reopen notice text changed. Do not assert on a speaker label.
     - tests/story.test.ts line ~272: `expect(first.speaker).toBe('The Informant')` — update to `toBe(STRANGER)` (import `STRANGER` from prologue) or to the new constant's value. The reroll lines keep a `.speaker`, so this stays a valid structural check.
     - tests/story-flow.test.ts journey test: the Wisdom scene now shows the ask beat. Keep the existing `/there is a book/` assertion on the `wisdom` arrival, then add a click on the new "How do you know all this?" button, assert the evasive answer text mentions "Stranger Eyes", then click "Open the book" and assert the book scene (`The cards` field, `Take these cards` labels) as before. Also cover the direct path: a separate assertion/flow that clicks "Just open the book" and reaches the book.
     - Add a new test (tests/story.test.ts, in the prologue describe): typing "Stranger" at `ask_name` is rejected hard — node stays `ask_name`, `nameAttempts` stays empty, the notice text matches the rejection line, and it is NOT keepable (there is no `confirm_name` with a "Yes, I am Stranger Eyes" option). Cover the normalization variants `"Stranger"`, `"  stranger  "`, `"stranger eyes"` all rejected, and confirm a normal name still works right after a rejected attempt.
     - The "every scene fits Discord" test iterates `Object.keys(NODES)`; the new `wisdom_ask` node is covered automatically — ensure its labels are ≤80 chars.
       Files: tests/story.test.ts, tests/story-flow.test.ts
       Verify: `./node_modules/.bin/vitest run tests/story.test.ts tests/story-flow.test.ts` passes; then `./node_modules/.bin/vitest run` shows only the two known pre-existing failures (commands.test.ts `shop`, commands-flow.test.ts `/profile`) and no new failures.

- [x] 9. Final full verification.
     Run the whole suite and the typechecker together to confirm a buildable, green-except-known-baseline state.
     Files: (none)
     Verify: `./node_modules/.bin/tsc --noEmit` passes; `./node_modules/.bin/vitest run` shows all story tests green and the failure count unchanged from baseline (the two unrelated pre-existing failures only). Clean up any temp files created during verification.

---

Notes / assumptions:

- `STRANGER` constant value: the exact string no longer renders (label hidden), so any value works; the plan uses `"Stranger"`. Tests should import the constant rather than hard-code the string, so a later rename stays safe.
- The two pre-existing test failures (`shop` command registration, `/profile` avatar mock) are out of scope and must be left untouched; the gate is "no NEW failures and no story regressions".
- `onEnter`/`showPack` stays only on the `book` node; the new `wisdom`/`wisdom_ask` nodes must not draw a pack. The engine draws the pack once on arrival at `book` from either the ask path or the direct path.

---

## Implementation results (iteration 1)

All nine plan items done. The shell's interactive zsh init garbles output capture, so commands were run with trailing `&& echo TSC_PASS`/`RC=$?` markers and output redirected to `/tmp`.

Commands run and results:

- Baseline typecheck `node ./node_modules/typescript/bin/tsc --noEmit` → clean (TSC_PASS).
- Baseline suite `node ./node_modules/vitest/vitest.mjs run` → 2 failed | 182 passed (184). The two failures are the known pre-existing ones: `tests/commands.test.ts` (`shop` registration) and `tests/commands-flow.test.ts > /profile` (`displayAvatarURL is not a function`).
- Post-change typecheck `node ./node_modules/typescript/bin/tsc --noEmit` → clean (TSC_PASS).
- Story suites `node ./node_modules/vitest/vitest.mjs run tests/story.test.ts tests/story-flow.test.ts` → 2 passed (2 files) | 43 passed (43 tests).
- Full suite `node ./node_modules/vitest/vitest.mjs run` → 2 failed | 183 passed (185). Still only the two known pre-existing failures; story suites all green; passing count rose by 1 (the new "Stranger" name-block test). No new failures, no story regressions.

What changed:

- `src/story/types.ts`: added `emoji?: string` to `StoryChoice`.
- `src/discord/story-view.ts`: render `choice.emoji` via `setEmoji`; `formatLine` no longer prints the bold speaker label — spoken lines render as plain text, gesture lines stay italic.
- `src/story/names.ts`: added `isStrangerStem(stem)` reusing the existing `normalize`/`stemOf`.
- `src/story/prologue.ts`: merged `GUIDE`+`INFORMANT` into one `STRANGER` + `stranger()` helper; rewrote every line in the direct single-stranger voice; reframed the curse so the stranger is the insider; added the `wisdom`/`wisdom_ask` ask-how-you-know beat routing into `book`; hard-blocked the reserved name "Stranger" in `ask_name.submit`.
- `docs/superpowers/specs/2026-10-04-story-design.md`: documented the single hidden-label stranger, the "Stranger Eyes" alias beat, the name block, and the map arrows.
- `tests/story.test.ts`, `tests/story-flow.test.ts`: updated step sequences and assertions for the new beat and hidden label; added the "Stranger" name-block test and the ask-beat routing.

# Voice and tone — player-facing text

The game has an archaic, high-fantasy flavor, but it lives in ONE place: the bot's STORYTELLING voice. Everywhere the player reads UI or clicks a control, keep text plain and easy. Flavor must never slow reading or hide what a button does.

## The register (level: moderate) — for the bot's story narration

Aim for an old, ceremonious, slightly mystical voice that is still easy to read. Evocative, not a grammar puzzle.

- DO lean on archaic/elevated diction and cadence: `hark`, `thus`, `whence`, `beyond`, `the old roads`, `I bid thee`, `come`, `heed`, `thy path`, `a boon`, `seek`, `tarry`, `yonder`.
- DO use `thee / thou / thy / thine` and old verb forms (`hast`, `doth`, `art`, `'tis`) **sparingly, for flavor** — a touch per passage, not every sentence.
- DO keep sentences understandable at a glance. If a line needs re-reading to parse, it is too heavy — pull it back.
- DON'T write full Early-Modern-English grammar everywhere (no relentless `thou goest / thou hast not`), and don't invent broken pseudo-archaic grammar. When unsure, prefer a clear, formal, old-sounding line over a dense one.

## Where the archaic voice applies — and how strongly

The archaic voice is the bot's storytelling voice. Apply it at full strength ONLY to the bot's story/narrative lines. Everywhere the player must read UI or act on a choice, dial it WAY down.

- **Story narrative lines spoken by the bot** (prologue + all story chapters): FULL archaic voice. This is the one place the register lives.
- **Choice / button labels the player clicks** (story choices, gate buttons, shop buttons, map arrows, battle controls, etc.): keep them PLAIN and clear. A very light archaic tint at most, only when it stays instantly readable. The player must know what a control does at a glance. Prefer `Continue`, `Yes`, `No`, `Open the book`, `Buy a variant`, `Back to the map` over heavy forms like "Onward, I bid thee".
- **Utility-command UI and messages** (`/shop`, `/daily`, `/collection`, `/card`, `/profile`, `/battle`, `/admin`, `/invite`, and all error/notice strings — closed-DM, "check your DMs", insufficient coins, not found, etc.): near-plain modern English. A faint flavor word is okay, but these are functional UI: easy and direct, NOT the full story register.
- **Slash-command descriptions:** plain, with at most a faint tint.

Rule of thumb: if the player is READING THE STORY, full voice; if the player is OPERATING THE BOT (reading a menu, clicking a button, reading an error), plain and clear.

## Scope — what stays

- **Slash-command names** stay plain modern English (`/story`, `/shop`, `/daily`, …) — players type them and Discord constrains naming.
- **Proper nouns stay exactly as-is:** the Vietnamese names (e.g. `Bò Tuôi`) and the setting's names (`The Eyes`, `Stranger Eyes`, `The Eyes Of Wisdom`).
- Keep the established single-stranger direct-address voice in the story (the bot speaks to the player as "thou/you"); the hidden speaker label stays.

## One voice only — never third-person for the speaker

The whole story is ONE speaker (the stranger / bot) talking to the player. There is no narrator and no other character who ever speaks.

- A gesture or stage-direction line (an italic narration line, not spoken dialogue) describes the SPEAKER'S OWN action. Write it in a clipped first-person stage-direction style that DROPS the leading "I" but KEEPS "my": "Draw my hood lower against the colder wind." (not "I draw my hood lower", and not "Draw the hood lower"). Dropping "I" makes it read like a stage cue; keeping "my" keeps it clearly the speaker's own action. Never refer to the speaker as "he/him/the stranger" in narration — that implies an outside narrator, which does not exist here. This clipped form applies ONLY to italic narration/gesture lines; the stranger's spoken dialogue lines keep normal "I ..." phrasing.
- "He/him/they" is allowed ONLY when the speaker is talking ABOUT someone else (e.g. the man inside the cave). Other characters never get their own quoted dialogue — the bot reports/paraphrases them in its own voice.

## Examples

Story narration (full voice):

- "Hark — the wind turns colder on the old road, and few now walk it."
- "I draw my hood lower. Come; the gate will not open itself."

Buttons / UI / errors (plain, clear — dialed down):

- "Continue" (button) → keep "Continue" (not "Onward, I bid thee").
- "Open the book" (button) → keep "Open the book".
- "Check your DMs" → "Check your DMs — we'll talk there." (plain)
- "You don't have enough coins." → keep plain, e.g. "You need more coins for that."
- "Card not found." → keep plain, e.g. "No card by that name."

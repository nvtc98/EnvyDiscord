# Card Battle Bot — Design

## Goal
A Discord bot for a trading-card game, driven by slash commands and buttons, usable in DMs (User Install) and in servers.
**PvE against an AI**, **collect cards, then battle**. Small scale: fewer than 20 players, fewer than 5 at the same time, run privately on a Synology NAS.

## Key decisions
| Topic | Decision | Reason |
|---|---|---|
| Discord connection | `discord.js` over the Gateway | Only outbound connections, so the NAS needs no open ports |
| Language | TypeScript run with `tsx`, tested with Vitest | Battle logic needs thorough tests |
| Storage | One JSON file, written atomically (temp file + rename), behind a `PlayerRepo` interface | Small scale, easy backup, no native dependency; switching to SQLite later only means replacing the repo |
| Battle state | In memory, keyed by `userId`, never written to disk | Every button click gives a fresh interaction, so the 15-minute interaction limit does not apply; a restart only loses battles in progress |
| Deployment | Run directly with Node (>= 20.6) on the Synology, started by Task Scheduler; `data/` sits next to the project | The owner does not use Docker; the code does not depend on Node 22, so upgrading later needs no changes |

## Structure
```
src/engine/    Pure battle logic (no discord.js): turns, damage, skills, AI
src/game/      Progression rules: gacha, duplicate level-ups, /daily, teams, AI opponents, rewards
src/data/      Card definitions
src/db/        PlayerRepo + JSON implementation
src/discord/   Slash commands, buttons, embeds
src/render/    Image rendering (cards and battle scene)
```

## Game rules
**Cards:** type (Fire/Water/Grass), rarity (Common/Rare/Epic/Legendary), HP/ATK/DEF/SPD, and 3 skills
(a basic attack with no cooldown, a strong attack with a cooldown, and a support skill that heals or shields).
**Type advantage:** Fire > Grass > Water > Fire. Advantage ×1.5, disadvantage ×0.5.
**Damage:** `ATK × power × 100 / (100 + DEF) × type multiplier`, minimum 1. A shield absorbs damage before HP is lost.
**3v3 battle:** each turn you pick a skill for the active card or switch cards. Switches resolve first, then skills in SPD order
(the player goes first on a tie). A fainted card is replaced automatically by the next one. A side with no cards left loses. A cooldown of N means the skill is unavailable for the next N turns.
**Card levels:** a duplicate gives +1 level (max 5, +10% stats per level). A duplicate of a max-level card is converted to 50 coins.
**AI:** Easy = random skill. Normal = picks the highest-value move by heuristic (knock-out > damage > heal when low > switch when at a type disadvantage). Hard = one-turn lookahead (minimax).

## Commands
The bot's language (commands, options, messages, card and skill names) is **English**; documentation is in English too.
`/daily` (3 different cards + 30 coins per day, using the configured timezone), `/collection`, `/card <name>`, `/team`, `/battle [difficulty]`, `/profile`,
plus `/say <content>`, `/merciful`, and the owner-only `/dm <message> [user] [user-id]`.
Every command is registered with `integration_types: [0,1]` and `contexts: [0,1,2]` so it works in DMs.
`/dm` checks that the caller is the application owner at runtime, so installing the app does not let anyone make the bot message strangers.

## Images
Cards and battles are drawn with `@napi-rs/canvas` into PNGs and sent as message attachments (Discord shows attachments larger than embed images).
- `src/render/`: `theme` (colors, type icons drawn as vector paths, no emoji), `art` (loads `assets/cards/<id>.(png|webp|jpg)`, watches mtime, downscales on load), `draw` (draws cards), `renderer` (API: `cards()` for a row of cards, `battle()` for the whole 3v3 scene).
- Cards without art use a placeholder: a type-colored gradient with a bokeh pattern that is stable per card id.
- The Inter font is bundled in `assets/fonts/` because the host (a NAS) often has no usable fonts.
- **Fallback:** the renderer is loaded dynamically in `index.ts`; if loading fails, `ctx.images = null` and every command uses text embeds. Render errors at runtime are caught in `tryRender` and also fall back to text.
- Image file names include the turn or page number so Discord never shows a cached older image.

## Out of scope (for now)
PvP, a shop or trading, spending coins, and persisting battles in progress across restarts.

## Testing
Vitest covers the engine, gacha and progression, AI, the JSON repo (including that a corrupt file is never overwritten), the renderer, the `/dm` and `/say` commands, and that every command carries the required `integration_types`/`contexts`.
`npm run simulate` plays AI against AI to check balance. `npm run preview` writes sample images to `preview/` so the look can be checked without Discord.

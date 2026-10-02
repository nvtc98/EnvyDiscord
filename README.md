# Card Battle Bot

A Discord bot for a PvE trading-card game: collect cards with `/daily`, build a team of three, and fight the AI in turn-based 3v3 battles (Pokémon-style). Cards and battles are rendered as images.
Detailed design: [docs/superpowers/specs/2026-10-02-card-battle-bot-design.md](docs/superpowers/specs/2026-10-02-card-battle-bot-design.md).

## Quick reference

### Bot configuration links
- All apps: <https://discord.com/developers/applications>
- Current app (**Evil Eyes**, Application ID `823859055796944907`):
  - General information (name, description, Application ID): <https://discord.com/developers/applications/823859055796944907/information>
  - Bot (Reset Token, avatar, Public Bot): <https://discord.com/developers/applications/823859055796944907/bot>
  - Installation (User Install / Guild Install, Install Link): <https://discord.com/developers/applications/823859055796944907/installation>

### Common commands

| Task | Command |
|---|---|
| Run the bot (reloads on code changes) | `npm run dev` |
| Run the bot (no reload, use this on the NAS) | `npm start` |
| Register the `/` commands with Discord | `npm run deploy` |
| Tests / type check | `npm test` · `npm run typecheck` |
| Render sample card and battle images without Discord | `npm run preview` (writes to `preview/`) |
| AI vs AI games to check game balance | `npm run simulate` |

Stop the bot with `Ctrl+C`. After editing `.env`, stop and restart the bot (`tsx watch` does not watch `.env`).

### When do I need to run `npm run deploy`?
- **The first time**, and whenever you **add, remove or rename a command, or change its options**.
- **Not needed** when you only change game rules, cards, or what a command replies.
- The bot must be running (`npm run dev`) for commands to respond. `deploy` only sends the command list to Discord; `dev` is what actually handles the commands.

### Two ways to register commands (`DEV_GUILD_ID` in `.env`)

| | With `DEV_GUILD_ID=<server id>` | Without it (empty or commented out with `#`) |
|---|---|---|
| Scope | One test server only | **Global**: every server and **DMs** |
| Appears | Immediately | May take a few minutes |
| Works in DMs | **No** | **Yes** (requires User Install) |
| Overwrites | Only that server's commands | All of the app's global commands |

To use the bot in DMs you **must** use global registration. Server commands and global commands are separate lists, so registering both makes every command appear twice in that server. To clear a server's commands, `PUT` an empty list to `Routes.applicationGuildCommands(clientId, guildId)`.

### Notes
- **The token is a secret.** Keep it in `.env` only (already in `.gitignore`); never paste it into chat or commit it. If it leaks, open the **Bot** page above, click **Reset Token**, and put the new token in `.env`.
- **One process per token.** Two bots sharing a token handle every command twice.
- If `/` shows no commands, quit Discord completely and reopen it (or press Cmd+R). In DMs the commands only appear after you enable **User Install** and click **Add to my apps** on the Install Link.
- The bot cannot read messages in a DM between two people (a Discord limit for User Install apps), so a DM message counter is not possible. The bot only receives data when someone runs a command.
- A **public** reply is visible to both people in a DM (it shows the bot's name and avatar plus a "used /command" line). An **ephemeral** (only-you) reply is invisible to the other person.
- A bot can only DM users who share a server with it and allow DMs from server members; otherwise Discord rejects the message (error 50007).

## Commands

The whole bot interface (command names, options, messages, card and skill names) is in **English**.

| Command | What it does | Visible to the other person in a DM? |
|---|---|---|
| `/daily` | Once a day, get 3 different cards + 30 coins (duplicates level a card up, max Lv 5) | Yes |
| `/collection` | Browse your collection | No |
| `/card <name>` | Show a card's details | Yes |
| `/team` | Pick 3 cards for your team (if you don't, the bot uses your 3 strongest) | No |
| `/battle [difficulty]` | 3v3 battle against the AI: easy / normal / hard | No |
| `/profile` | Coins, wins and losses | No |
| `/say <content>` | The bot says exactly what you type (cannot ping @everyone or mentions) | Yes |
| `/dm <message> [user] [user-id]` | **Bot owner only.** The bot sends a direct message to a user (works only if they share a server with the bot and allow DMs) | No (only you see the result) |
| `/merciful` | The bot replies: "Merciful be, all my eyes." | Yes |

Type advantage: 🔥 Fire > 🌿 Grass > 💧 Water > 🔥 Fire (advantage ×1.5, disadvantage ×0.5).

## Card images

Cards and battles are drawn as **PNG images** (rarity frames, type icons, HP bars, shields, K.O. overlay):

| Command | Image |
|---|---|
| `/card` | One full card with stats and its 3 skills |
| `/daily` | The 3 cards you just got, with NEW / LV n / MAX badges |
| `/collection` | 3 cards per page |
| `/battle` | Both teams in one image, redrawn every turn (active card large, bench cards small) |

**Adding real art:** put a file at `assets/cards/<card id>.png` (png, webp and jpg all work). Cards without art get a generated placeholder based on their type. New or replaced files are picked up automatically, no restart needed. Art specs and the list of file names are in [assets/cards/README.md](assets/cards/README.md).

**Text fallback:** if the image library cannot run (for example on a NAS) or a single render fails, the bot falls back to text embeds and the game stays playable. On startup the terminal prints `Image rendering enabled`, or `Image rendering unavailable, falling back to text embeds: ...` with the reason.

The **Inter** font (SIL OFL license) is bundled in `assets/fonts/`, so rendering does not depend on fonts installed on the host. When moving to a NAS, copy the whole `assets/` folder.

## Discord setup (one time)

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. **Bot** → Reset Token, and put the token in `.env` as `DISCORD_TOKEN`. No privileged intents are needed.
3. **General Information** → copy the *Application ID* into `.env` as `DISCORD_CLIENT_ID`. (The Application ID is also the first part of the token, base64-encoded.)
4. **Installation** → enable both **User Install** and **Guild Install**, then copy the *Install Link*.
   - **User Install** is what makes `/` commands show up in every DM.
   - Guild Install needs the `applications.commands` scope (add `bot` if the bot should be a member of the server).
5. Open the Install Link and choose **Add to my apps** (installs it on your account). Friends do the same to use it in DMs with each other.

## Run locally

```bash
cp .env.example .env     # fill in DISCORD_TOKEN and DISCORD_CLIENT_ID
npm install
npm run deploy           # register commands (see "Two ways to register commands")
npm run dev              # run the bot, reloads on code changes
```

You should see `Online as ...` in the terminal. Player data is stored in `data/players.json`.

## Run on a Synology NAS (directly, no Docker)

Install Node.js from Package Center. **Node 20.6 or newer** is enough (Node 22 also works). The bot only connects *out* to Discord, so no ports need to be opened.

1. Copy the project to the NAS (without `node_modules` and `data`, but **with** the `assets/` folder), for example to `/volume1/cardbot`, and create a `.env` there.
2. SSH into the NAS and install the runtime dependencies (this skips the test tools, because `vitest` needs Node 22):
   ```bash
   cd /volume1/cardbot && npm ci --omit=dev
   ```
3. Try it: `npm start`. You should see `Image rendering enabled` (if you see `unavailable`, the bot still runs in text mode) and then `Online as ...`.
4. Start it automatically on boot: Control Panel → Task Scheduler → Create → Triggered Task → User-defined script, event **Boot-up**, and paste:
   ```bash
   cd /volume1/cardbot && npm start >> bot.log 2>&1
   ```
   If the task cannot find `npm`, run `which node` over SSH and use the full path.
5. Register the commands once from your dev machine with `npm run deploy` (not needed on the NAS). Stop the bot on your dev machine before starting the NAS copy.

Backup: save `data/players.json` (Hyper Backup or copy it by hand).
Updating: copy over the `src` folder (and `package*.json`, then `npm ci --omit=dev` if dependencies changed), keep the `data` folder, then restart the task.
Moving to Node 22 later needs no code changes.

## Development

```bash
npm test            # Vitest: engine, gacha, AI, JSON repo, renderer, Discord payload limits
npm run typecheck
npm run simulate    # AI vs AI games to check balance
```

Add a card: edit `src/data/cards.ts` (each card needs exactly 3 skills, and the first must be a basic attack with no cooldown). Never rename an existing card id, because ids are stored in players' save files.
Add a command: create a file in `src/discord/commands/`, add it to `src/discord/commands/index.ts`, then run `npm run deploy`.

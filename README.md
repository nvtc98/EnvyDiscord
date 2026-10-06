# Card Battle Bot

A Discord bot for a dark, mysterious story-driven trading-card game: follow the story with `/story` (conversations, choices, a map and card duels), collect cards, build a 12-card deck, and fight in a lane battle on a 3x3 board. Cards and battles are rendered as images. Everything the bot does and every message it sends or receives is logged to JSON Lines files.
Design documents: the story is in [docs/superpowers/specs/2026-10-04-story-design.md](docs/superpowers/specs/2026-10-04-story-design.md); the battle rules and cards are in [2026-10-04-lane-battle-design.md](docs/superpowers/specs/2026-10-04-lane-battle-design.md); hosting, storage, logging and images are in [2026-10-02-card-battle-bot-design.md](docs/superpowers/specs/2026-10-02-card-battle-bot-design.md).

## Quick reference

### Bot configuration links

- All apps: <https://discord.com/developers/applications>
- Current app (**Evil Eyes**, Application ID `823859055796944907`):
  - General information (name, description, Application ID): <https://discord.com/developers/applications/823859055796944907/information>
  - Bot (Reset Token, avatar, Public Bot): <https://discord.com/developers/applications/823859055796944907/bot>
  - Installation (User Install / Guild Install, Install Link): <https://discord.com/developers/applications/823859055796944907/installation>

### Common commands

| Task                                                               | Command                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------- |
| Run the bot (reloads on code changes)                              | `npm run dev`                                               |
| Run the bot (no reload, use this on the NAS)                       | `npm start`                                                 |
| Register the `/` commands with Discord                             | `npm run deploy`                                            |
| Tests / type check                                                 | `npm test` · `npm run typecheck`                            |
| Render sample card and battle images without Discord               | `npm run preview` (writes to `preview/`)                    |
| AI vs AI games to check game balance                               | `npm run simulate`                                          |
| Remove the white background of a card frame exported from Dextrous | `npm run frame:cutout -- in.png out.png [layout.json]`      |
| Regenerate the colour variant frames from the Blue frame           | `npm run frames:variants [-- --sheet preview/variants.png]` |

Stop the bot with `Ctrl+C`. After editing `.env`, stop and restart the bot (`tsx watch` does not watch `.env`).

### When do I need to run `npm run deploy`?

- **The first time**, and whenever you **add, remove or rename a command, or change its options**.
- **Not needed** when you only change game rules, cards, or what a command replies.
- The bot must be running (`npm run dev`) for commands to respond. `deploy` only sends the command list to Discord; `dev` is what actually handles the commands.

### Two ways to register commands (`DEV_GUILD_ID` in `.env`)

|              | With `DEV_GUILD_ID=<server id>` | Without it (empty or commented out with `#`) |
| ------------ | ------------------------------- | -------------------------------------------- |
| Scope        | One test server only            | **Global**: every server and **DMs**         |
| Appears      | Immediately                     | May take a few minutes                       |
| Works in DMs | **No**                          | **Yes** (requires User Install)              |
| Overwrites   | Only that server's commands     | All of the app's global commands             |

To use the bot in DMs you **must** use global registration. Server commands and global commands are separate lists, so registering both makes every command appear twice in that server. To clear a server's commands, `PUT` an empty list to `Routes.applicationGuildCommands(clientId, guildId)`.

### Notes

- **The token is a secret.** Keep it in `.env` only (already in `.gitignore`); never paste it into chat or commit it. If it leaks, open the **Bot** page above, click **Reset Token**, and put the new token in `.env`.
- **One process per token.** Two bots sharing a token handle every command twice.
- If `/` shows no commands, quit Discord completely and reopen it (or press Cmd+R). In DMs the commands only appear after you enable **User Install** and click **Add to my apps** on the Install Link.
- The bot cannot read messages in a DM between two people (a Discord limit for User Install apps), so a DM message counter is not possible. The bot only receives data when someone runs a command.
- A **public** reply is visible to both people in a DM (it shows the bot's name and avatar plus a "used /command" line). An **ephemeral** (only-you) reply is invisible to the other person.
- A bot can only DM users who share a server with it and allow DMs from server members; otherwise Discord rejects the message (error 50007).
- Once the bot has a DM with someone, their replies reach the bot as ordinary messages (the bot has the `DirectMessages` intent, which is not privileged) and are logged. The bot never sees DMs between two other people.

## Commands

The whole bot interface (command names, options, messages, card and skill names) is in **English**.

| Command                          | What it does                                                                                                                                                                                                                                                                                                                                       | Visible to the other person in a DM? |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `/story [restart]`               | Begin the story, or continue exactly where you left off. `restart` (bot owner only) erases your progress and begins again                                                                                                                                                                                                                          | No                                   |
| `/daily`                         | **Unlocks after you take your first 12 cards in the story.** Once a day, get 3 different random cards + 30 coins. A card you already own unlocks its next cosmetic colour **variant** (metal → blue → purple → red); once a card owns every variant a duplicate refunds coins; when every card owns every variant there is nothing left to receive | Yes                                  |
| `/collection`                    | Browse your collection, 3 cards per page                                                                                                                                                                                                                                                                                                           | No                                   |
| `/card <name>`                   | Show a card's cost, power and ability                                                                                                                                                                                                                                                                                                              | Yes                                  |
| `/deck`                          | Pick the 12 cards you take into battle. With fewer than 12 cards you own, battles fill the gaps with guest cards that are never added to your collection                                                                                                                                                                                           | No                                   |
| `/battle [difficulty]`           | **Bot owner only for now.** Practice lane battle against the AI: easy / normal / hard. Players reach battles through `/story`                                                                                                                                                                                                                      | No                                   |
| `/profile`                       | Coins, wins and losses                                                                                                                                                                                                                                                                                                                             | No                                   |
| `/say <content>`                 | The bot says exactly what you type (cannot ping @everyone or mentions)                                                                                                                                                                                                                                                                             | Yes                                  |
| `/dm <message> [user] [user-id]` | **Bot owner only.** The bot sends a direct message to a user (works only if they share a server with the bot and allow DMs)                                                                                                                                                                                                                        | No (only you see the result)         |

## The story

`/story` begins the story for a new player and continues from the last scene for everyone else, so it is the only command a player needs to move forward. Progress is saved after every choice. The story has three kinds of scenes:

1. **Conversation and choices**: the bot speaks, the player answers with buttons, or by typing in a form (their name).
2. **Map**: a simple picture with places to go (never more than four choices).
3. **Card duel**: the lane battle below (not in the story yet).

**What exists now (the prologue):** the Guide asks whether you are one of The Eyes; if you say yes you give your name, and the game adds "Eyes" for you (type `Ocean`, you become `Ocean Eyes`). The name is checked against the list of The Eyes in `src/data/cards.json`; if it is not found, the Guide suggests the closest name and lets you say it again or keep what you typed. Every name you typed is saved. Then the Guide asks whether you know where the Bò Tuôi live, warns you about the tribe's curse, and you meet the Informant, who wants a duel but owns no Eyes deck. The map shows The Eyes Of Wisdom (left), where you are (middle) and Bò Tuôi (right); Bò Tuôi is "not yet". In The Eyes Of Wisdom you open a book that gives your **first 12 cards: 2 eternal, 2 bargain and 8 common, all different**. You can close the book and open it again for another twelve as often as you like; the cards are yours only when you take them, which also sets them as your deck and unlocks `/daily`. The prologue ends there for now.

The story's text and scenes are in `src/story/prologue.ts`; the story engine is `src/story/engine.ts` (pure logic, no Discord), and the Discord side is `src/discord/commands/story.ts`. Design: [story design](docs/superpowers/specs/2026-10-04-story-design.md).

## How a battle works

Full rules: [lane battle design](docs/superpowers/specs/2026-10-04-lane-battle-design.md). In short:

- Each side has a **12-card deck**, **20 HP** and a hand. The first player starts with 2 cards, the second with 3; everyone draws 1 at the start of each of their turns.
- **Energy** is `min(your turn number, 9)` and refills every turn. Play as many cards as you can pay for.
- The board has **3 lanes (Left, Middle, Right) of 3 cells**. A card enters a lane from your edge (the bottom). If the cell is taken, that card is **pushed** one step toward the enemy, and so on down the lane. A gap absorbs the push; if there is no gap, the card at the far end is **destroyed**, whoever owns it. The enemy pushes from the top.
- After both players have played, the round resolves: end-of-round passives, then **each player loses HP equal to the total power of the other's cards on the board**. Reach 0 HP and you lose. After round 30 the higher HP wins.
- Cards have a **cost**, a **power** and at most one ability: _active_ (once, when played) or _passive_ (continuous, or at the end of each round).
- In Discord: pick a card in the menu, press a lane (a 💥 means the push destroys an enemy card, ⚠️ one of yours), then **End turn**. The bot answers and the next round starts.

## Card images

Cards and battles are drawn as **PNG images**:

| Command       | Image                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| `/card`       | One full card (art, frame, cost, power, name and ability text)                                               |
| `/daily`      | The 3 cards you just got, with NEW / variant-name badges                                                     |
| `/collection` | 3 cards per page                                                                                             |
| `/battle`     | Both players' HP, the 3x3 board with the cards, your energy and your numbered hand; redrawn after every play |

**How a card is built (layers, bottom to top):**

1. **Art**: `assets/cards/<card id>.png` (png, webp or jpg), cropped to fit the card. A card without art gets a generated placeholder.
2. **Frame**: `assets/frames/variant-<id>.png` (one per cosmetic colour variant: `variant-metal.png`, `variant-blue.png`, …), a PNG with **transparency**, so the art shows through (the description box can be semi-transparent). A variant without its own file falls back to `variant-metal.png`, then any other variant file, so one is enough to start. With no frame file at all, the bot draws a built-in frame in the same style, coloured by the variant's palette. See [the variant-system design](docs/superpowers/specs/2026-10-05-variant-system-design.md).
3. **Text**: name, ability text, cost (top left) and power (top right), drawn by the bot using the positions in `assets/frames/layout.json`.

New or replaced art and frame files are picked up automatically, no restart needed.

**Card design tool:** frames are designed in [Dextrous](https://www.dextrous.com.au/decks). `layout.json` uses Dextrous pixels (the Poker card is 240 x 336, ratio 5:7), copied from Dextrous's layout export, so the text lands where it does in Dextrous. Export the frame at **750 x 1050** (or any 5:7 size of at least 480 x 672).

**Dextrous exports a white background, not a transparent one.** Fix a frame with:

```bash
npm run frame:cutout -- Blue_frame.png assets/frames/variant-blue.png Blue_layout.json
```

It makes the white transparent (with clean edges, no white halo) and restores boxes that Dextrous flattened onto the white, such as the description box at 48% opacity. The layout JSON is optional but needed for that last part. The original files for the current frame are kept in `assets/frames/source/`.

Art specs and the list of file names: [assets/cards/README.md](assets/cards/README.md).

**Board cards** are a compact landscape version of the same design (art, name banner, cost and power in the corners, an inner line in blue for your cards and red for the enemy's, a gold diamond for cards with an ability), because full portrait cards would be unreadable on a 3x3 board in a chat.

**Look:** near-black surfaces, bone-colored text, a murky arena with cold light on your side and ember light on the enemy's. The palette lives in `src/render/theme.ts`.

**Text fallback:** if the image library cannot run (for example on a NAS) or a single render fails, the bot falls back to text embeds and the game stays playable. On startup the terminal prints `Image rendering enabled`, or `Image rendering unavailable, falling back to text embeds: ...` with the reason.

Fonts (SIL OFL license) are bundled in `assets/fonts/`: **Inter** (HUD numbers), **Cinzel** (headings) and **Aleo** (card text, the typeface of the Dextrous design). When moving to a NAS, copy the whole `assets/` folder.

## Logs

The bot writes two append-only streams, one file per day (day boundaries follow `BOT_TZ`), in `logs/` (override with `LOG_DIR`; the folder is git-ignored). Every line is one JSON object with a `ts` (ISO time) and a `type`, which makes the files easy to `grep`, `jq` or load into any tool later.

| File                        | Contains                        | Event types                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `game-YYYY-MM-DD.jsonl`     | Gameplay                        | `story_event` (each scene reached, every name typed and how it matched, the final name, each set of 12 cards shown with how many times it was redrawn, and the 12 cards taken), `story_restarted`, `daily_claimed`, `deck_set`, `battle_started` (decks, who goes first, difficulty), `battle_event` (every card played, ability, round resolution and game over, as the engine reports them, so a battle can be replayed), `battle_ended` |
| `messages-YYYY-MM-DD.jsonl` | What the bot receives and sends | `interaction` (a command, button or submitted form received, with its options or field values), `bot_response` (everything the bot replied: text, embed titles, attachment names, whether it was private), `dm_message` (messages in a DM with the bot, `direction: "in"` or `"out"`), `owner_dm` (each `/dm` attempt and whether Discord accepted it), `say_later_failed`, `error`                                                        |

`interactionId` ties a command to the replies it caused. Replies to a message the bot sent on its own arrive as `dm_message` with `direction: "in"`.

Message text is logged by default. Set `LOG_CONTENT=false` to keep who/when/what-kind but replace message text with `[hidden, N chars]`. Message logs contain private conversations, so treat the folder accordingly and tell the people who talk to the bot that it keeps logs. Logging never blocks or breaks the bot: a failed write only prints a warning.

Examples (needs [jq](https://jqlang.github.io/jq/)):

```bash
# Every finished battle
jq -c 'select(.type=="battle_ended")' logs/game-*.jsonl
# Everything people wrote to the bot in DMs
jq -r 'select(.type=="dm_message" and .direction=="in") | "\(.ts) \(.username): \(.content)"' logs/messages-*.jsonl
# Which commands are used most
jq -r 'select(.type=="interaction" and .kind=="command") | .name' logs/messages-*.jsonl | sort | uniq -c | sort -rn
```

Not logged: messages in servers (the bot does not read them) and DMs between two other people (Discord does not deliver them to the bot).

## Discord setup (one time)

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. **Bot** → Reset Token, and put the token in `.env` as `DISCORD_TOKEN`. No privileged intents are needed.
3. **General Information** → copy the _Application ID_ into `.env` as `DISCORD_CLIENT_ID`. (The Application ID is also the first part of the token, base64-encoded.)
4. **Installation** → enable both **User Install** and **Guild Install**, then copy the _Install Link_.
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

Install Node.js from Package Center. **Node 20.6 or newer** is enough (Node 22 also works). The bot only connects _out_ to Discord, so no ports need to be opened.

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
npm test            # Vitest: engine rules, AI, collection and decks, JSON repo, renderer, frame cutout, Discord flows
npm run typecheck
npm run simulate    # AI vs AI games to check balance (win rates by seat and difficulty, game length)
```

The card list is `src/data/cards.json` (one entry per card with its name, rarity — `common`, `bargain` or `eternal` — cost, power, an optional ability shorthand, and an optional Vietnamese designer `note`). This file is the single source of truth; `src/data/cards.ts` loads it and `src/data/ability-parse.ts` turns each ability shorthand (e.g. `rebirth 4`) into the card's ability. The card id is made from the name (`Alterra's Eyes` becomes `alterras-eyes`), so **renaming a card changes its id and breaks players' saved collections**. To add or edit stats and abilities, edit `cards.json`; the rules text is generated from the ability unless you set `text`.
Add an ability kind: add it to the types in `src/engine/types.ts`, give it a rules-text sentence in `src/engine/abilities.ts`, handle it in `src/engine/rules.ts`, and add tests in `tests/engine.test.ts`.
Run `npm run preview` after changing anything under `src/render/` to see the result.
Add a command: create a file in `src/discord/commands/`, add it to `src/discord/commands/index.ts`, then run `npm run deploy`.

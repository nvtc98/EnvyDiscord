# Lane Battle — Design

Supersedes the 3v3 skill battle described in `2026-10-02-card-battle-bot-design.md`. Everything else in that document (hosting, storage, logging, images, commands that are not mentioned here) still applies.

> **Update:** the 15 placeholder cards in this document were replaced by the 229 cards of `eyes-names.json` (placeholder stats, no abilities yet). See [story design](2026-10-04-story-design.md). Practice battles via `/battle` are owner-only until the story reaches its first duel.

## Goal

A two-player card battle played on a 3×3 board, first against the bot's AI and later against other people. Players spend energy to push cards into three lanes. Cards on the board hurt the opponent's HP every round. The player whose HP reaches 0 first loses.

Players collect cards (daily packs, later the story) and build a **12-card deck**. Collecting never makes a card stronger: duplicates only unlock cosmetic colour **variants** (see [the variant-system design](2026-10-05-variant-system-design.md), which supersedes the frame-tier notes below).

## What changes

| Area       | Before                                                   | After                                                                                 |
| ---------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Battle     | 3v3 skill fights (HP/ATK/DEF/SPD, elements, skills)      | Lane battle described below                                                           |
| Card stats | HP, ATK, DEF, SPD, element, rarity, 3 skills             | `cost`, `power`, one optional ability                                                 |
| Team       | `/team` picks 3 cards                                    | `/deck` picks 12 cards                                                                |
| Duplicates | Level up (+10% stats), max-level duplicate becomes coins | Unlock the next cosmetic colour variant; once all are owned a duplicate refunds coins |
| Rarity     | Common to Legendary, weights the pack draw               | Removed for now; the draw is uniform over cards still missing a variant               |
| Card art   | Placeholder only                                         | Layers: art, then a transparent frame PNG, then text (see "Card rendering")           |

Kept as is: `/daily` pack size and once-per-day rule, `/collection`, `/card`, `/profile`, `/say`, `/dm`, logging, the dark theme, JSON storage, text fallback when images are unavailable.

## Terms

- **Lane**: one of three columns (Left, Middle, Right). A lane has three **cells**, indexed 0 (top, the opponent's edge as seen by a human player) to 2 (bottom, the human player's edge).
- **Turn**: one player's action phase. **Round**: the first player's turn, the second player's turn, then the resolution step. Round `n` contains each player's `n`-th turn.
- **Active ability**: happens once, when the card is played.
- **Passive ability**: always applies while the card is on the board. Two kinds: **continuous** (a standing modifier) and **end of round** (triggers during resolution, before damage).

## Rules

### Setup

1. Each side has a deck of 12 different cards, shuffled.
2. Who goes first is decided by a coin flip.
3. Opening hands: the first player draws 2 cards, the second player draws 3.
4. Both players start with 20 HP.

### A turn

1. **Draw** one card (nothing happens if the deck is empty). There is no fatigue and no hand limit. With the opening hands above, turn 1 starts with 3 cards for the first player and 4 for the second.
2. **Energy** is set to `min(n, 9)` where `n` is the number of turns this player has taken, counting this one. It refills every turn; unspent energy is lost.
3. **Play cards**: any number, as long as the total cost fits the energy. To play a card, pay its cost and choose a lane. Cards cost 0 or more.
4. **End the turn.**

### Pushing a card into a lane

A player enters a lane from their own edge: the human (and the player who sees the board from the bottom) enters at cell 2, the opponent at cell 0. The new card is placed in the entry cell. If that cell is occupied, its card is pushed one step toward the far edge, which may push the next card, and so on. The chain stops at the first empty cell, so an empty cell absorbs the push. If the chain reaches the edge, the card at the far edge is pushed off the board and **destroyed** (it leaves the game; whoever owns it).

```
cells top→bottom, human plays X from the bottom

[E1][E2][P1] + X  →  [E2][P1][X ]      E1 destroyed
[E1][  ][P1] + X  →  [E1][P1][X ]      empty cell absorbed the push
[E1][E2][  ] + X  →  [E1][E2][X ]      no push needed
[P1][P2][P3] + X  →  [P2][P3][X ]      P1 is destroyed: pushing into your own full lane costs you a card
```

The opponent does the mirror image: enters at cell 0 and pushes toward cell 2.

After the card is placed and the push is resolved, its **active** ability (if any) resolves.

### Resolution (after the second player's turn)

1. **End-of-round passives** resolve in a fixed order: lane Left, Middle, Right; inside a lane, top to bottom.
2. **Damage**: each player loses HP equal to the sum of the effective power of the **opponent's** cards on the board. Both players are hit at the same time.
3. **Win check.**
4. The next round begins with the first player's turn.

**Effective power** = base power + permanent buffs, multiplied by the lane multiplier (see "double damage" below), never below 0. It is computed when it is needed, so a card that is pushed off the board stops counting immediately.

### Ending

- A player at 0 HP or less loses. If both reach 0 or less in the same resolution, the game is a draw.
- After round 30 the player with more HP wins; equal HP is a draw. This stops stalemates where nobody can add power.
- A player can forfeit during their own turn.

## Abilities (version 1 catalogue)

Each card has at most one ability. The engine keeps abilities in a registry; adding a new kind is one small function plus tests. Version 1 contains the kinds below, enough to express the examples the design needs and to be replaced by real cards later.

| Timing                | Kind         | Effect                                                                                                                               |
| --------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Active                | `heal` n     | The owner heals n HP (capped at 20).                                                                                                 |
| Active                | `damage` n   | The opponent loses n HP immediately.                                                                                                 |
| Active                | `draw` n     | The owner draws n cards.                                                                                                             |
| Active                | `energy` n   | The owner gains n energy for the rest of this turn. This can take the total above 9; the cap of 9 only limits the per-turn refill.   |
| Active                | `buffLane` n | The owner's other cards that are in this lane when the card is played gain n power permanently. Cards played later are not affected. |
| Passive, continuous   | `laneDouble` | The owner's cards in this card's lane deal double damage, this card included. Several in one lane do not stack beyond ×2.            |
| Passive, continuous   | `anchor`     | This lane cannot be pushed. A card may be played into it only if the entry cell is empty.                                            |
| Passive, end of round | `heal` n     | The owner heals n HP before damage is dealt.                                                                                         |

Notes for later cards: "swap lanes", "destroy a card", "on destroyed" triggers and several abilities per card are out of scope for version 1. `anchor` is implemented with the meaning above and should be checked against the first real card that uses it.

## Placeholder cards

Fifteen cards keep the existing ids, so players' collections stay valid. Names and numbers are placeholders for play-testing and will be replaced by real cards. The cost curve (4 cards at cost 1, 3 at 2, 3 at 3, 2 at 4, 2 at 5, 1 at 6) exists so that turn 1, which has 1 energy, usually has something to play; the first version had only two 1-cost cards and about 40% of opening hands could not play anything.

| id                | Name          | Cost | Power | Ability                       |
| ----------------- | ------------- | ---- | ----- | ----------------------------- |
| `tho-lua`         | Ember Hare    | 1    | 2     | none                          |
| `nam-con`         | Little Shroom | 1    | 1     | Passive, end of round: heal 1 |
| `cao-than`        | Cinder Fox    | 1    | 1     | Active: gain 1 energy         |
| `rua-bien`        | Sea Turtle    | 1    | 1     | Passive: anchor               |
| `ca-chep`         | Koi Carp      | 2    | 2     | Active: draw 1                |
| `soi-rung`        | Forest Wolf   | 2    | 3     | none                          |
| `ca-map`          | Blue Shark    | 2    | 2     | Active: damage 2              |
| `ho-rung`         | Forest Tiger  | 3    | 3     | Passive: lane double          |
| `co-thu`          | Elder Tree    | 3    | 3     | Active: buff lane +2          |
| `su-tu-dung-nham` | Magma Lion    | 3    | 4     | none                          |
| `hoa-long`        | Fire Drake    | 4    | 4     | Active: damage 3              |
| `thuy-quai`       | Kraken        | 4    | 6     | none                          |
| `phuong-hoang`    | Phoenix       | 5    | 5     | Active: heal 4                |
| `than-rung`       | Forest Spirit | 5    | 4     | Active: draw 2                |
| `long-vuong`      | Dragon King   | 6    | 8     | none                          |

## Collection and decks

- **Variants**: `players.cards[id]` is `{ variants: VariantId[]; active: VariantId }` — the cosmetic colour variants the player owns (always including `metal`) and the one shown. Variants change nothing in battle. The registry (`src/data/variants.ts`) is the single source of truth and ordering. See [the variant-system design](2026-10-05-variant-system-design.md).
- **Packs**: `/daily` gives 3 different cards drawn uniformly from the cards still missing a variant (unowned, or owned but incomplete). A new card is granted as `metal`; a duplicate unlocks the next variant in registry order, and once a card owns every variant a duplicate refunds `DUPLICATE_REBATE` coins. If fewer than 3 cards remain, the pack is smaller. If every card owns every variant the command says the collection is complete and does not use up the day.
- **Deck**: `/deck` is a select menu with exactly 12 options from the owned cards. The deck is saved on the player (`players.deck`); the old `players.team` field is ignored.
- **Guest cards**: a player who owns fewer than 12 cards, or whose saved deck is invalid, plays with their owned cards topped up with random cards they do not own. Guest cards exist only for that battle and are never added to the collection. This keeps a new player able to battle straight away while the collection stays meaningful.
- **Coins and rewards** are unchanged for now (win/lose amounts per AI difficulty). Money, refunds for maxed cards and any story rewards are decided later.

## Opponent AI

It plays by the same rules, with three difficulties:

- **Easy**: plays random legal moves while energy lasts.
- **Normal**: greedy. For each legal play it scores `power gained on its side − power removed from the player − energy wasted` and keeps playing the best-scoring card, preferring to push where it destroys a player's card.
- **Hard**: like normal, plus a one-round lookahead that checks lethal and avoids pushing off its own best card.

The AI evaluates a candidate play by running the engine's own `playCard` on a copy of the state, so it never needs separate logic that could drift from the rules.

## Architecture

Pure engine, no Discord imports, deterministic given an RNG:

```
src/engine/
  types.ts      Card, Ability, Cell/Lane/Board, PlayerState, GameState, Action
  push.ts       insertCard(lane, card, side) → { lane, destroyed }
  effects.ts    registry of ability kinds: active / continuous / endOfRound
  rules.ts      newGame, startTurn, legalPlays, playCard, endTurn, resolveRound, winner
  ai.ts         chooseTurn(state, side, difficulty, rng) → list of plays
src/data/cards.ts    placeholder cards
src/game/            gacha (excludes fully-complete cards), player (variants), shop (variant purchases), deck building and guest cards
src/discord/         /battle flow, /deck, views
src/render/          layered card rendering, battle scene
```

Removed: the old skill engine (`fighter`, skills, elements, rarity), `/team`, level scaling.

## Discord interface

`/battle [difficulty]` sends a private message (only the player sees it, so the hand stays hidden):

- **Image**: both players' HP and energy, the 3×3 board with cards, and the player's hand as a numbered strip.
- **Row 1, select menu**: the cards in hand. Each option reads `3. Forest Wolf — cost 3, power 4` and its description shows the ability. Up to 25 options.
- **Row 2, three buttons**: Left, Middle, Right. They are disabled until a card is selected, when the card costs more than the remaining energy, or when the lane is anchored and the play would push. Once a card is selected a button shows what the push would do: 💥 (green) destroys an enemy card, ⚠️ (red) destroys one of yours, plain blue destroys nothing.
- **Row 3**: End turn, Forfeit.

Flow: choose a card (this only changes the controls; the image is not redrawn, so it is instant), press a lane (the card is played and the image is redrawn). Press End turn: the opponent plays (its plays are listed in the message), the round resolves (end-of-round effects and damage are listed), and the next round starts with a draw and refilled energy. If the bot goes first it plays immediately when the battle starts. The battle ends with a Victory, Defeat or Draw view. Battle state lives in memory per player, as before.

If images are unavailable the same message shows the board and hand as text.

## Card rendering

Cards are built from three layers, bottom to top:

1. **Art**: `assets/cards/<id>.png`, 5:7, filling the whole card, clipped to the card's rounded outline. Missing art uses a placeholder whose hue comes from the card id.
2. **Frame**: `assets/frames/variant-<id>.png`, a PNG or WebP with transparency, drawn over the art, so the art shows through the transparent areas and through semi-transparent parts of the frame such as the description box. A variant without a file falls back to `variant-metal.png`, then any other variant file in registry order; with no file at all the renderer draws a built-in frame in the same style (a reproduction of the Dextrous "Blue" frame), coloured by the variant's palette (title gradient + description fill) with a black border.
3. **Text**: name, rules text, cost (top-left) and power (top-right), in Aleo, placed by `assets/frames/layout.json`.

`layout.json` is in Dextrous pixels (card 240 × 336, ratio 5:7) copied from the Dextrous layout export, and is scaled to the output size, so changing the frame design in Dextrous means editing numbers, not code. Text shrinks to fit its box; the rules text wraps and is vertically centred in the description box.

**Frame files from Dextrous have an opaque white background.** `npm run frame:cutout` (`src/render/cutout.ts`) converts them: white becomes transparent, anti-aliased edges become partial alpha of the neighbouring colour (no white halo), and semi-transparent boxes that the export flattened onto white are restored to their colour and alpha using the layout export (the 48% navy description box was recovered exactly: the flattened colour (134,148,163) is `rgba(3,32,62,0.48)` over white). A test checks that the cut-out frame, laid back over white, matches the original within 3/255.

Frame specs: ratio **5:7**; export at **750 × 1050**, 480 × 672 at minimum; the renderer keeps up to 760 px width when loading frames. Cards are designed in [Dextrous](https://www.dextrous.com.au/decks).

**Board cards** are a compact landscape version (196 × 118): full-bleed art, name banner, cost and power in black octagons at the top corners, a thin inner line in blue (player) or red (opponent), and a gold diamond for cards with an ability. Full portrait cards on the board would be unreadable in a chat, which shows attachments at roughly 400 px high. They use a black border and the variant's banner style; dedicated board-card frames are a later option. Full cards are used by `/card`, `/daily` and `/collection`. The hand is drawn as a numbered strip of compact cards under the board; the numbers match the select menu.

The battle image is 700 × (≈800–1000) CSS px drawn at 1.5× (1050 px wide): enemy HP, lane headers (with `ANCHORED` and `x2` tags), the 3 × 3 board with dashed empty cells, your HP and energy pips, and the hand. Cards you cannot afford are dimmed, and the winner overlay says VICTORY, DEFEAT or DRAW.

## Logging

Game stream: `daily_claimed`, `deck_set`, `battle_started` (decks, guests, who goes first, difficulty), `battle_event` (one per engine event: cards played with lane and destroyed cards, abilities, turn ends, round resolutions with damage and HP, game over; card objects are reduced to ids so a battle can be replayed from the log) and `battle_ended` (winner, rounds, forfeit, coins). The message stream is unchanged.

## Testing

- **Push**: table-driven cases from both edges, empty cells absorbing pushes, full lanes destroying the far card (including your own), anchored lanes.
- **Turn flow**: opening hands 2/3, draw every turn, energy `min(n, 9)` and refill, cost checks, multiple plays per turn, coin flip.
- **Resolution**: end-of-round order, simultaneous damage, lane double damage, power clamp at 0, win, draw and the 30-round rule.
- **Abilities**: one test per kind, including heal cap, draw from an empty deck, energy this turn only.
- **AI**: always legal, never spends more than its energy, hard takes available lethal.
- **Collection**: packs skip fully-complete cards, duplicates unlock the next variant then refund coins, completed collections, guest top-up.
- **Rendering and Discord**: layered rendering with and without frame and art files, transparency actually showing the art, board image sizes, component rows and disabled states, text fallback.
- The simulation script plays AI against AI to check that games end and neither seat wins far more often.

## Known balance issue: the second player has a large advantage

AI against AI with random 12-card decks (400 games, normal difficulty, who goes first alternating), measured with `npm run simulate` and a throw-away experiment on the opening hands:

| Opening hands (first / second) | First player wins | Second player wins | Draws | Avg rounds |
| ------------------------------ | ----------------- | ------------------ | ----- | ---------- |
| 2 / 3 (the rules as specified) | 15%               | 76%                | 10%   | 4.4        |
| 3 / 3                          | 21%               | 65%                | 14%   | 4.4        |
| 4 / 3                          | 28%               | 61%                | 11%   | 4.4        |
| 4 / 2                          | 43%               | 48%                | 10%   | 4.5        |
| 5 / 2                          | 47%               | 42%                | 11%   | 4.5        |

Why: the second player acts last every round, so it sees the whole board, can push the first player's cards off before the damage step, and the first player never gets to answer. Extra cards for the second player make it worse, not better. Games are also short (about 4 rounds), so there is little time to recover.

Options, not applied yet because this is a rules decision: give the extra opening cards to the **first** player instead; alternate who acts first every round (each player is "last" every other round); resolve damage after each player's turn instead of once per round; give the first player extra energy in round 1. Each can be tried quickly with the simulation script.

## Out of scope for this version

Story, PvP between people (the engine is symmetric so it can be added), money, rarity, several abilities per card, on-destroy triggers, deck presets, dedicated board-card frames, animation.

## Assumptions to confirm

1. A coin flip decides who goes first.
2. Guest cards fill decks of players who own fewer than 12 cards.
3. `anchor` means "no pushing in this lane".
4. Variants are cosmetic and come from the registry; there is no numeric cap, just the registry's set.
5. Coin rewards for battles stay as they are (a draw pays the same as a loss).

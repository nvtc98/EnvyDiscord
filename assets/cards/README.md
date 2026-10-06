# Card art

Drop each card's artwork in this folder. The file name is the **card id** plus `.png`, `.webp`, `.jpg` or `.jpeg`.
Cards without a file get a generated placeholder, so you can add art one card at a time. The bot picks up new or replaced files automatically (no restart needed).

## Which cards exist

Every card comes from `src/data/cards.json` — that list is the single source of truth, and a card can only exist if it is in that file. There are no other cards.

The card **id** is the card name run through `slugify()` (lowercase, accents stripped, apostrophes removed, every run of non-alphanumerics turned into a single `-`). So the file name follows directly from the name:

| Card name (in cards.json) | Card id          | Art file              |
| ------------------------- | ---------------- | --------------------- |
| `Abyss Eyes`              | `abyss-eyes`     | `abyss-eyes.png`      |
| `Alterra's Eyes`          | `alterras-eyes`  | `alterras-eyes.png`   |
| `Celestial Eyes`          | `celestial-eyes` | `celestial-eyes.webp` |

Drop a file named after the id and that exact card shows the art immediately.

## Art specs

- The art fills the **whole card**; the frame (`assets/frames/variant-<id>.png`) is drawn on top of it. Keep the subject away from the corners (the cost and power badges) and away from the bottom quarter (name banner and description box, where the art shows through the semi-transparent box).
- Ratio **5:7 (portrait)**, same as the card. Recommended **750×1050**; anything of at least 480×672 works. The bot crops to fit ("cover") and downsizes on load to save RAM.
- Under ~2 MB per file. Do not draw the frame, name, cost, power or text; the bot draws those.
- Do not use copyrighted artwork you do not have the rights to.
- See `_template-*.png` in this folder for the safe-area layout (where badges and the name banner sit). Those are guides only — delete or ignore them; they are not card art.

On the battle board the card is shown as a compact landscape crop of the same art, so the subject should sit near the middle of the upper two thirds.

Preview the result without Discord: `npm run preview` (images are written to `preview/`).

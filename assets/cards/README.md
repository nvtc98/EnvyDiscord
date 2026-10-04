# Card art

Drop each card's artwork in this folder. The file name is the **card id** plus `.png`, `.webp`, `.jpg` or `.jpeg`.
Cards without a file get a generated placeholder, so you can add art one card at a time. The bot picks up new or replaced files automatically (no restart needed).

## Art specs
- The art fills the **whole card**; the frame (`assets/frames/tier-<n>.png`) is drawn on top of it. Keep the subject away from the corners (the cost and power badges) and away from the bottom quarter (name banner and description box, where the art shows through the semi-transparent box).
- Ratio **5:7 (portrait)**, same as the card. Recommended **750×1050**; anything of at least 480×672 works. The bot crops to fit ("cover") and downsizes on load to save RAM.
- Under ~2 MB per file. Do not draw the frame, name, cost, power or text; the bot draws those.
- Do not use copyrighted artwork you do not have the rights to.

On the battle board the card is shown as a compact landscape crop of the same art, so the subject should sit near the middle of the upper two thirds.

Preview the result without Discord: `npm run preview` (images are written to `preview/`).

## Card list

| File | Card name | Cost | Power |
|---|---|---|---|
| `tho-lua.png` | Ember Hare | 1 | 2 |
| `nam-con.png` | Little Shroom | 1 | 1 |
| `cao-than.png` | Cinder Fox | 1 | 1 |
| `rua-bien.png` | Sea Turtle | 1 | 1 |
| `ca-chep.png` | Koi Carp | 2 | 2 |
| `soi-rung.png` | Forest Wolf | 2 | 3 |
| `ca-map.png` | Blue Shark | 2 | 2 |
| `ho-rung.png` | Forest Tiger | 3 | 3 |
| `co-thu.png` | Elder Tree | 3 | 3 |
| `su-tu-dung-nham.png` | Magma Lion | 3 | 4 |
| `hoa-long.png` | Fire Drake | 4 | 4 |
| `thuy-quai.png` | Kraken | 4 | 6 |
| `phuong-hoang.png` | Phoenix | 5 | 5 |
| `than-rung.png` | Forest Spirit | 5 | 4 |
| `long-vuong.png` | Dragon King | 6 | 8 |

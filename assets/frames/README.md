# Card frames

- `tier-1.png` … `tier-5.png`: the frame drawn over the card art, **PNG or WebP with transparency**. A tier without its own file uses the nearest lower tier. Frame tiers are cosmetic: a card goes up a tier each time you receive a duplicate (max 5).
- `layout.json`: where the text goes, in Dextrous pixels (card 240 × 336). Edit these numbers to move or resize the name, ability text, cost and power. Text can also be given another color, weight or alignment there.
- `source/`: the files exported from Dextrous for the current frame ("Blue"): `blue-template.png` (white background, as exported), `blue-layout.json` (the Dextrous layout export, read by the cutout tool).

## Adding a frame for another tier

1. In Dextrous, design the frame with the card art area left empty. Export the PNG at 750 × 1050 (5:7).
2. Remove the white background: `npm run frame:cutout -- exported.png assets/frames/tier-2.png exported-layout.json`
3. Run `npm run preview` to see it.

If the new frame has its numbers or text in other places, update `layout.json` too (one layout is shared by all tiers).

# Card frames

- `variant-metal.png`, `variant-blue.png`, `variant-purple.png`, `variant-red.png`: the frame drawn over the card art, one per colour variant, **PNG with transparency**. A variant without its own file falls back to `variant-metal.png`, then to any other variant file, then to the built-in drawn frame. Variants are cosmetic only. The list of variants and their colours is `src/data/variants.ts`.
- `layout.json`: where the text goes, in Dextrous pixels (card 240 × 336). Edit these numbers to move or resize the name, ability text, cost and power. Text can also be given another color, weight or alignment there.
- `source/`: the files exported from Dextrous for the **Blue** frame, the standard the other variants are made from: `blue-template.png` (white background, as exported) and `blue-layout.json` (the Dextrous layout export).
- `tier-1.png`: the old cutout of the Blue frame, from before variants. Nothing loads it any more; a test still uses it to check that `variant-blue.png` is the untouched original.

## The variant frames are generated, not drawn

Only Blue comes from Dextrous. Metal, Purple and Red are Blue with a different title banner and description panel, and the colours of those two regions are the only things that differ (the outline and the cost and power badges are shared). So:

```bash
npm run frames:variants                                      # rewrites every variant-<id>.png
npm run frames:variants -- --sheet preview/variants.png      # also writes a contact sheet of all variants
```

The command removes the white background of `source/blue-template.png`, then recolours the banner and the panel with the colours in `src/data/variants.ts`:
- **Banner**: the radial gradient between `titleLight` and `titleDark`. Every banner pixel's position on the Blue gradient is moved to the same position on the new gradient, so the shape, the soft edges and the transparency stay exactly as they were.
- **Description panel**: the pixels take `descFill`'s colour and their transparency is scaled to its opacity.

A test fails when a file no longer matches the registry, so after changing a colour in `variants.ts` (or adding a variant) run `npm run frames:variants` and commit the files. A new variant needs no new artwork: it is one more entry in the registry.

## Using a frame you drew in Dextrous instead

If a variant needs a different design rather than a recolour (a different outline, other badges), export it from Dextrous at 750 × 1050 (5:7), remove its white background, and save it over the generated file:

```bash
npm run frame:cutout -- exported.png assets/frames/variant-<id>.png exported-layout.json
```

Note that `npm run frames:variants` overwrites every `variant-<id>.png`, so a hand-made frame would be replaced the next time it runs. If you want to keep one, tell me and I will make the generator skip that variant.

Run `npm run preview` to see the result. If the frame has its numbers or text in other places, update `layout.json` too (one layout is shared by all variants).

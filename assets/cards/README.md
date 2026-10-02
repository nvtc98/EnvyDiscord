# Card art

Drop each card's artwork in this folder. The file name is the **card id** plus `.png`, `.webp`, `.jpg` or `.jpeg`.
Cards without a file get a generated placeholder, so you can add art one card at a time. The bot picks up new or replaced files automatically (no restart needed).

## Art specs
- **4:3 landscape**, recommended **1024×768** (larger is fine; the bot downscales on load to save RAM).
- Keep the subject **centered** with roughly 10% margin on each side: the art is cropped to fit the frame ("cover"), so the edges can be cut off, especially in the battle scene where the frame is closer to square.
- Under ~2 MB per file. Do not draw the frame, name or stats; the bot draws those.
- Do not use copyrighted artwork you do not have the rights to (for example Pokémon).

Preview the result without Discord: `npm run preview` (images are written to `preview/`).

## Card list

| File | Card name | Type | Rarity |
|---|---|---|---|
| `tho-lua.png` | Ember Hare | fire | common |
| `cao-than.png` | Cinder Fox | fire | common |
| `su-tu-dung-nham.png` | Magma Lion | fire | rare |
| `hoa-long.png` | Fire Drake | fire | epic |
| `phuong-hoang.png` | Phoenix | fire | legendary |
| `rua-bien.png` | Sea Turtle | water | common |
| `ca-chep.png` | Koi Carp | water | common |
| `ca-map.png` | Blue Shark | water | rare |
| `thuy-quai.png` | Kraken | water | epic |
| `long-vuong.png` | Dragon King | water | legendary |
| `nam-con.png` | Little Shroom | grass | common |
| `soi-rung.png` | Forest Wolf | grass | common |
| `ho-rung.png` | Forest Tiger | grass | rare |
| `co-thu.png` | Elder Tree | grass | epic |
| `than-rung.png` | Forest Spirit | grass | legendary |

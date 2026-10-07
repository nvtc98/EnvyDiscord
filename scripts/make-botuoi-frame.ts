// Bakes the Bò Tuôi frame from its Dextrous export into a transparent PNG.
//   npm run frames:botuoi
// Mirrors `loadBaseFrame` in src/render/variant-frames.ts (the Eyes pipeline): it removes the white
// background of `assets/frames/botuoi/source/template.png`, un-blending the semi-transparent olive
// description panel using the positions in `source/layout.json`, then writes
// `assets/frames/botuoi/frame.png`. Bò Tuôi has no colour variants, so there is no recolour step.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ImageData, createCanvas, loadImage } from "@napi-rs/canvas";
import {
  compositeOver,
  overlaysFromDextrousLayout,
  whiteToTransparent,
} from "../src/render/cutout";

const botuoiDir = fileURLToPath(
  new URL("../assets/frames/botuoi", import.meta.url),
);
const sourceDir = `${botuoiDir}/source`;

const image = await loadImage(await readFile(`${sourceDir}/template.png`));
const canvas = createCanvas(image.width, image.height);
const ctx = canvas.getContext("2d");
ctx.drawImage(image, 0, 0);
const source = ctx.getImageData(0, 0, image.width, image.height);

const dextrous = JSON.parse(await readFile(`${sourceDir}/layout.json`, "utf8"));
const overlays = overlaysFromDextrousLayout(dextrous, image.width);
const data = whiteToTransparent(
  source.data,
  image.width,
  image.height,
  overlays,
);

// Hard guard: laid back over white, the cutout must match the original closely. A real cutout
// regression (dissolving opaque artwork into the overlay colour) shows up as a diff in the hundreds,
// so this still catches a broad failure. The tolerance is 30/255, not 3, to allow the known ~1px
// gold/olive AA seam at the title-band / panel-top boundary (y=787): the olive panel sits at top
// 787.5, so that half-covered row is a gold-tinted anti-aliased blend, and the overlay model
// ("olive over white") structurally cannot reproduce a gold-tinted AA pixel. (The generic
// frame-cutout.ts only logs this; here a regression throws so a bad bake never ships.)
const SEAM_TOLERANCE = 30;
const back = compositeOver(data, [255, 255, 255]);
const original = compositeOver(source.data, [255, 255, 255]);
let worst = 0;
for (let i = 0; i < back.length; i += 4)
  for (let c = 0; c < 3; c++)
    worst = Math.max(worst, Math.abs(back[i + c] - original[i + c]));
if (worst > SEAM_TOLERANCE)
  throw new Error(
    `Bò Tuôi cutout changed the frame over white by ${worst}/255 (max ${SEAM_TOLERANCE}): the cutout is lossy, not just removing white`,
  );

ctx.putImageData(new ImageData(data, image.width, image.height), 0, 0);
await writeFile(`${botuoiDir}/frame.png`, canvas.toBuffer("image/png"));

console.log(
  `${image.width}x${image.height} -> assets/frames/botuoi/frame.png (overlays restored: ${overlays.length}; round-trip over white within ${worst}/255)`,
);

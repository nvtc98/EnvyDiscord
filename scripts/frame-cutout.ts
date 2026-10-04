// Removes the white background of a card frame exported from Dextrous.
//   npm run frame:cutout -- <input.png> <output.png> [layout.json]
// `layout.json` is the Dextrous layout export; it lets the script restore semi-transparent boxes
// (such as the description box) that were flattened onto the white background.
import { readFile, writeFile } from 'node:fs/promises';
import { ImageData, createCanvas, loadImage } from '@napi-rs/canvas';
import { compositeOver, cutoutStats, overlaysFromDextrousLayout, whiteToTransparent } from '../src/render/cutout';

const [input, output, layoutPath] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: npm run frame:cutout -- <input.png> <output.png> [layout.json]');
  process.exit(1);
}

const image = await loadImage(input);
const canvas = createCanvas(image.width, image.height);
const ctx = canvas.getContext('2d');
ctx.drawImage(image, 0, 0);
const source = ctx.getImageData(0, 0, image.width, image.height);

const overlays = layoutPath ? overlaysFromDextrousLayout(JSON.parse(await readFile(layoutPath, 'utf8')), image.width) : [];
const result = whiteToTransparent(source.data, image.width, image.height, overlays);

// Safety check: laid back over white, the result must look like the original.
const back = compositeOver(result, [255, 255, 255]);
const original = compositeOver(source.data, [255, 255, 255]); // the source may already contain transparent pixels
let worst = 0;
for (let i = 0; i < back.length; i += 4) for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(back[i + c] - original[i + c]));

ctx.putImageData(new ImageData(result, image.width, image.height), 0, 0);
await writeFile(output, canvas.toBuffer('image/png'));

const total = image.width * image.height;
const stats = cutoutStats(result);
const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;
console.log(`${image.width}x${image.height} -> ${output}`);
console.log(`transparent ${pct(stats.transparent)} · semi-transparent ${pct(stats.semiTransparent)} · opaque ${pct(stats.opaque)}`);
console.log(`overlays restored: ${overlays.length}${overlays.map((o) => ` (rgb ${o.rgb.join(',')} at ${(o.alpha * 100).toFixed(0)}%)`).join('')}`);
console.log(`round-trip over white differs from the original by at most ${worst} / 255 per channel`);

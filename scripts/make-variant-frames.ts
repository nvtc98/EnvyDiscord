// Writes assets/frames/variant-<id>.png for every variant in src/data/variants.ts.
//   npm run frames:variants [-- --sheet preview/variants-sheet.png]
// The frames are derived from the Blue frame in assets/frames/source/ by recolouring the title banner and the
// description panel with the registry's colours, so changing a colour (or adding a variant) there and running this
// command is all it takes. A test checks that the shipped files are up to date with the registry.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { buildAllVariantFrames, encodePng, frameFileName } from '../src/render/variant-frames';

const framesDir = fileURLToPath(new URL('../assets/frames', import.meta.url));
const sheetIndex = process.argv.indexOf('--sheet');
const sheetPath = sheetIndex > 0 ? process.argv[sheetIndex + 1] : null;

const frames = await buildAllVariantFrames(framesDir);
const pngs: { id: string; name: string; png: Buffer }[] = [];
for (const { variant, frame } of frames) {
  const png = encodePng(frame);
  await writeFile(`${framesDir}/${frameFileName(variant.id)}`, png);
  pngs.push({ id: variant.id, name: variant.name, png });
  console.log(`${frameFileName(variant.id).padEnd(20)} ${variant.colors.titleLight} -> ${variant.colors.titleDark}   description ${variant.colors.descFill}   ${(png.length / 1024).toFixed(0)} KB`);
}

// A contact sheet: every variant over the same bright test pattern, so the colours and the translucent panel are easy to judge.
if (sheetPath) {
  const w = 375;
  const h = 525;
  const sheet = createCanvas(pngs.length * (w + 16) + 16, h + 32);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  for (const [i, { png }] of pngs.entries()) {
    ctx.save();
    ctx.translate(16 + i * (w + 16), 16);
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#ffb347');
    g.addColorStop(0.5, '#e8f0ff');
    g.addColorStop(1, '#3d7a4a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(await loadImage(png), 0, 0, w, h);
    ctx.restore();
  }
  await mkdir(dirname(sheetPath), { recursive: true });
  await writeFile(sheetPath, sheet.toBuffer('image/png'));
  console.log(`contact sheet -> ${sheetPath}`);
}

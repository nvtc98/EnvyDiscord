import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { CARD_INDEX } from "../src/data/cards";
import {
  compositeOver,
  overlaysFromDextrousLayout,
  whiteToTransparent,
} from "../src/render/cutout";
import { parseLayout } from "../src/render/layout";
import { createImageRenderer } from "../src/render/renderer";

const FRAMES = join(__dirname, "..", "assets", "frames");
const BOTUOI = join(FRAMES, "botuoi");
const REAL_ASSETS = join(__dirname, "..", "assets");

async function readPng(file: string) {
  const img = await loadImage(await readFile(file));
  const ctx = createCanvas(img.width, img.height).getContext("2d");
  ctx.drawImage(img, 0, 0);
  return {
    data: ctx.getImageData(0, 0, img.width, img.height).data,
    width: img.width,
    height: img.height,
  };
}

describe("the Bò Tuôi frame shipped in assets", () => {
  it("is up to date: rebuilding it in memory from source matches the shipped frame", async () => {
    const source = await readPng(join(BOTUOI, "source", "template.png"));
    const dextrous = JSON.parse(
      await readFile(join(BOTUOI, "source", "layout.json"), "utf8"),
    );
    const overlays = overlaysFromDextrousLayout(dextrous, source.width);
    const rebuilt = whiteToTransparent(
      source.data,
      source.width,
      source.height,
      overlays,
    );
    const shipped = await readPng(join(BOTUOI, "frame.png"));
    expect([shipped.width, shipped.height]).toEqual([
      source.width,
      source.height,
    ]);
    // Compare over white, within the PNG round-trip tolerance (the frame is stored as a PNG).
    const a = compositeOver(shipped.data, [255, 255, 255]);
    const b = compositeOver(rebuilt, [255, 255, 255]);
    let worst = 0;
    for (let i = 0; i < a.length; i++)
      worst = Math.max(worst, Math.abs(a[i] - b[i]));
    expect(worst, "run npm run frames:botuoi").toBeLessThanOrEqual(4);
  });

  it("the layout parses and the olive description panel sits at the scaled source position", async () => {
    const layout = parseLayout(
      JSON.parse(await readFile(join(BOTUOI, "layout.json"), "utf8")),
    );
    // Scale 750/240 = 3.125: description x≈56.25, y≈787.5, w≈637.5, h≈225.
    expect(layout.fields.description).toMatchObject({
      x: 18,
      y: 252,
      width: 204,
      height: 72,
    });
    const scale = 750 / layout.card.width;
    expect(layout.fields.description.x * scale).toBeCloseTo(56.25, 1);
    expect(layout.fields.description.y * scale).toBeCloseTo(787.5, 1);
    expect(layout.fields.description.width * scale).toBeCloseTo(637.5, 1);
    expect(layout.fields.description.height * scale).toBeCloseTo(225, 1);
    // The name band sits higher and taller than the Eyes frame (banner-roof shape).
    expect(layout.fields.name).toMatchObject({ y: 216, height: 36 });
  });
});

describe("the four Bò Tuôi cards render", () => {
  it("render as valid PNGs in their faction frame without throwing", async () => {
    const renderer = await createImageRenderer({ assetsDir: REAL_ASSETS });
    for (const id of [
      "bo-tuoi",
      "bo-sieu-phan-ong-cap-1",
      "bo-sieu-phan-ong-cap-2",
      "bo-sieu-phan-ong-cap-3",
    ]) {
      const def = CARD_INDEX.get(id)!;
      const png = await renderer.cards([{ def, variant: "metal" }]);
      expect(png.subarray(0, 8), id).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    }
  });

  it("the longest name 'Bò Siêu Phản Động Cấp 1' fits the name band without shrinking below its font size", async () => {
    // Mirror the renderer's name draw: fitFont at the botuoi layout's name field. If the fitted
    // size equals the configured fontSize, the name was NOT shrunk (no clip). The draw uses the
    // card font at weight 700 with padding 3 on each side.
    const { GlobalFonts } = await import("@napi-rs/canvas");
    const { CARD_FONT } = await import("../src/render/theme");
    for (const [file] of [["Aleo-Bold.ttf"], ["Aleo-Regular.ttf"]] as const)
      GlobalFonts.registerFromPath(join(REAL_ASSETS, "fonts", file), CARD_FONT);
    const layout = parseLayout(
      JSON.parse(await readFile(join(BOTUOI, "layout.json"), "utf8")),
    );
    const f = layout.fields.name;
    const ctx = createCanvas(f.width, f.height).getContext("2d");
    const name = CARD_INDEX.get("bo-sieu-phan-ong-cap-1")!.name;
    const pad = f.padding ?? 3;
    ctx.font = `${f.weight} ${f.fontSize}px ${CARD_FONT}`;
    const width = ctx.measureText(name).width;
    expect(width, `name "${name}" width vs band`).toBeLessThanOrEqual(
      f.width - pad * 2,
    );
  });
});

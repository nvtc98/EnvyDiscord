import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CARDS } from "../src/data/cards";
import { playAiTurn } from "../src/engine/ai";
import { endTurn, legalPlays, newGame, playCard } from "../src/engine/rules";
import type { GameState } from "../src/engine/types";
import { parseLayout, DEFAULT_LAYOUT } from "../src/render/layout";
import { createImageRenderer } from "../src/render/renderer";
import { mulberry32 } from "../src/util/rng";

const REAL_ASSETS = join(__dirname, "..", "assets");
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const size = (png: Buffer) => ({
  width: png.readUInt32BE(16),
  height: png.readUInt32BE(20),
});

/** A temp assets folder with the real fonts and layout but no card art and no frames, so tests control both. */
async function tempAssets(withFrame = false) {
  const dir = await mkdtemp(join(tmpdir(), "assets-"));
  await cp(join(REAL_ASSETS, "fonts"), join(dir, "fonts"), { recursive: true });
  await mkdir(join(dir, "cards"));
  await mkdir(join(dir, "frames"));
  await cp(
    join(REAL_ASSETS, "frames", "layout.json"),
    join(dir, "frames", "layout.json"),
  );
  // The real variant-blue frame is the Dextrous "Blue" cutout; copy it as the blue variant for frame tests.
  if (withFrame)
    await cp(
      join(REAL_ASSETS, "frames", "variant-blue.png"),
      join(dir, "frames", "variant-blue.png"),
    );
  return dir;
}

async function solidPng(
  color: string,
  width = 400,
  height = 300,
): Promise<Buffer> {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return canvas.toBuffer("image/png");
}

/** The pixel at (x, y) of a PNG. */
async function pixel(png: Buffer, x: number, y: number): Promise<number[]> {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  return Array.from(ctx.getImageData(x, y, 1, 1).data);
}

/** A battle a few rounds in, built with the real engine. */
function midGame(): GameState {
  const rng = mulberry32(21);
  let state = newGame(
    { bottom: CARDS.slice(0, 12), top: CARDS.slice(3, 15) },
    "bottom",
    rng,
  ).state;
  for (let round = 0; round < 3; round++) {
    for (const play of legalPlays(state).slice(0, 1))
      state = playCard(state, play.uid, play.lane).state;
    state = endTurn(state).state;
    state = playAiTurn(state, "normal", rng).state;
  }
  return state;
}

afterEach(() => vi.restoreAllMocks());

describe("layout", () => {
  it("the shipped layout.json parses and matches the built-in default", async () => {
    const { readFile } = await import("node:fs/promises");
    const parsed = parseLayout(
      JSON.parse(
        await readFile(join(REAL_ASSETS, "frames", "layout.json"), "utf8"),
      ),
    );
    expect(parsed.card).toEqual(DEFAULT_LAYOUT.card);
    expect(parsed.fields.name).toMatchObject({
      x: 6,
      y: 228,
      width: 228,
      height: 24,
    });
    expect(parsed.fields.description).toMatchObject({
      x: 18,
      y: 252,
      width: 204,
      height: 72,
    });
    expect(parsed.fields.cost).toMatchObject({ x: -6, y: -6 });
    expect(parsed.fields.power).toMatchObject({ x: 204, y: -6 });
  });

  it("rejects a layout with a missing number instead of drawing garbage", () => {
    expect(() => parseLayout({ card: { width: 240 } })).toThrow(/card.height/);
  });
});

describe("card images", () => {
  it("draws every card as a valid PNG of the expected size", async () => {
    const renderer = await createImageRenderer({ assetsDir: REAL_ASSETS });
    for (const def of CARDS) {
      const png = await renderer.cards([{ def, variant: "purple" }], {
        scale: 1.5,
      });
      expect(png.subarray(0, 8).equals(PNG_SIGNATURE), def.id).toBe(true);
      expect(size(png), def.id).toEqual({ width: 360 + 28, height: 504 + 28 });
    }
    const row = await renderer.cards(
      CARDS.slice(0, 3).map((def) => ({ def, variant: "metal", badge: "NEW" })),
    );
    expect(size(row)).toEqual({ width: 3 * 360 + 4 * 14, height: 504 + 28 });
  });

  it("uses the frame file, and the art shows through its transparent areas", async () => {
    const assets = await tempAssets(true);
    await writeFile(
      join(assets, "cards", `${CARDS[0].id}.png`),
      await solidPng("#ff00ff"),
    );
    const renderer = await createImageRenderer({ assetsDir: assets });
    const png = await renderer.cards([{ def: CARDS[0], variant: "blue" }], {
      scale: 3,
    }); // 720 px wide, easy to sample
    // Middle of the card is transparent in the frame, so the magenta art is visible there.
    const middle = await pixel(png, 14 + 360, 14 + 300);
    expect(middle[0]).toBeGreaterThan(200); // red channel high
    expect(middle[1]).toBeLessThan(60); // green low
    expect(middle[2]).toBeGreaterThan(200); // blue high
    // The frame's black border is opaque on top of the art.
    const border = await pixel(png, 14 + 6, 14 + 500);
    expect(border.slice(0, 3)).toEqual([0, 0, 0]);
  });

  it("the description box is semi-transparent: art stays visible through it, tinted by the frame", async () => {
    const assets = await tempAssets(true);
    await writeFile(
      join(assets, "cards", `${CARDS[0].id}.png`),
      await solidPng("#ffffff"),
    );
    const renderer = await createImageRenderer({ assetsDir: assets });
    const png = await renderer.cards([{ def: CARDS[0], variant: "blue" }], {
      scale: 3,
    });
    // A point inside the description box but away from any text (bottom-left corner of the box).
    const inside = await pixel(png, 14 + 70, 14 + 3 * 322);
    // White art under 48% navy (3,32,62) is about (134,148,163): lighter than the navy, darker than white.
    expect(inside[0]).toBeGreaterThan(110);
    expect(inside[0]).toBeLessThan(160);
    expect(inside[2]).toBeGreaterThan(inside[0]);
  });

  it("falls back to the built-in frame when no frame file exists, and to the one existing frame otherwise", async () => {
    const none = await createImageRenderer({
      assetsDir: await tempAssets(false),
    });
    const builtIn = await none.cards([{ def: CARDS[1], variant: "blue" }]);
    expect(builtIn.length).toBeGreaterThan(0);

    const withFrame = await createImageRenderer({
      assetsDir: await tempAssets(true),
    });
    // Only variant-blue.png exists in the temp assets; a variant without its own file falls back to it.
    const blue = await withFrame.cards([{ def: CARDS[1], variant: "blue" }]);
    const red = await withFrame.cards([{ def: CARDS[1], variant: "red" }]); // no variant-red file: uses variant-blue
    expect(red.equals(blue)).toBe(true);
    expect(blue.equals(builtIn)).toBe(false);
  });

  it("picks up replaced art without a restart and survives a corrupt art file", async () => {
    const assets = await tempAssets();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const renderer = await createImageRenderer({ assetsDir: assets });
    const def = CARDS[2];
    const placeholder = await renderer.cards([{ def, variant: "metal" }]);

    await writeFile(
      join(assets, "cards", `${def.id}.png`),
      await solidPng("#00ffff"),
    );
    const withArt = await renderer.cards([{ def, variant: "metal" }]);
    expect(withArt.equals(placeholder)).toBe(false);

    await writeFile(
      join(assets, "cards", `${def.id}.png`),
      "this is not an image",
    );
    expect(
      (await renderer.cards([{ def, variant: "metal" }])).equals(placeholder),
    ).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    await renderer.cards([{ def, variant: "metal" }]);
    expect(warn).toHaveBeenCalledTimes(1); // not repeated on every render
  });

  it("refuses to start without the bundled fonts", async () => {
    const empty = await mkdtemp(join(tmpdir(), "nofonts-"));
    await expect(createImageRenderer({ assetsDir: empty })).rejects.toThrow(
      /font/,
    );
  });
});

describe("battle scene", () => {
  it("draws a mid-game board quickly, under Discord's size limit, in every state", async () => {
    const renderer = await createImageRenderer({ assetsDir: REAL_ASSETS });
    const state = midGame();
    const started = performance.now();
    const normal = await renderer.battle({
      state,
      viewer: "bottom",
      selectedUid: state.players.bottom.hand[0]?.uid ?? null,
    });
    const won = await renderer.battle({
      state: { ...state, winner: "bottom" },
      viewer: "bottom",
    });
    const lost = await renderer.battle({
      state: { ...state, winner: "top" },
      viewer: "bottom",
    });
    const drawn = await renderer.battle({
      state: { ...state, winner: "draw" },
      viewer: "bottom",
    });
    const perImage = (performance.now() - started) / 4;

    expect(size(normal).width).toBe(1050);
    expect(size(normal).height).toBeGreaterThan(900);
    for (const png of [normal, won, lost, drawn])
      expect(png.length).toBeLessThan(3 * 1024 * 1024);
    expect(perImage).toBeLessThan(1000); // Discord wants an answer within 3 seconds
  });

  it("copes with an empty board, an empty hand, a full hand and the viewer sitting at the top", async () => {
    const renderer = await createImageRenderer({ assetsDir: REAL_ASSETS });
    const fresh = newGame(
      { bottom: CARDS.slice(0, 12), top: CARDS.slice(0, 12) },
      "top",
      mulberry32(2),
    ).state;
    const empty = structuredClone(fresh);
    empty.players.bottom.hand = [];
    const full = structuredClone(fresh);
    while (full.players.bottom.deck.length > 0) {
      const def = full.players.bottom.deck.shift()!;
      full.players.bottom.hand.push({
        uid: full.nextUid++,
        def,
        owner: "bottom",
        bonus: 0,
      });
    }
    expect(full.players.bottom.hand).toHaveLength(12);
    for (const [state, viewer] of [
      [fresh, "bottom"],
      [empty, "bottom"],
      [full, "bottom"],
      [midGame(), "top"],
    ] as const) {
      const png = await renderer.battle({ state, viewer });
      expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    }
  });

  it("a tall hand makes a taller image, an empty hand a shorter one", async () => {
    const renderer = await createImageRenderer({ assetsDir: REAL_ASSETS });
    const base = newGame(
      { bottom: CARDS.slice(0, 12), top: CARDS.slice(0, 12) },
      "bottom",
      mulberry32(4),
    ).state;
    const none = structuredClone(base);
    none.players.bottom.hand = [];
    const many = structuredClone(base);
    for (let i = 0; i < 6; i++)
      many.players.bottom.hand.push({
        uid: 900 + i,
        def: CARDS[i],
        owner: "bottom",
        bonus: 0,
      });
    const heights = [none, base, many].map(
      async (state) =>
        size(await renderer.battle({ state, viewer: "bottom" })).height,
    );
    const [h0, h1, h2] = await Promise.all(heights);
    expect(h0).toBeLessThan(h1);
    expect(h1).toBeLessThanOrEqual(h2);
  });
});

describe("story images", () => {
  const map = {
    locations: [
      { id: "wisdom", name: "The Eyes Of Wisdom", x: 0.16, y: 0.5 },
      { id: "crossroads", name: "The Crossroads", x: 0.5, y: 0.5, here: true },
      { id: "tribe", name: "Bò Tuôi", x: 0.84, y: 0.5 },
    ],
    links: [
      ["crossroads", "wisdom"],
      ["crossroads", "tribe"],
    ] as [string, string][],
  };

  it("draws the map as a valid PNG, and a different map looks different", async () => {
    const renderer = await createImageRenderer({ assetsDir: REAL_ASSETS });
    const a = await renderer.map(map);
    expect(a.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect(size(a)).toEqual({ width: 1050, height: 450 });
    const moved = await renderer.map({
      ...map,
      locations: map.locations.map((l) =>
        l.here ? { ...l, here: false } : { ...l, here: l.id === "wisdom" },
      ),
    });
    expect(moved.equals(a)).toBe(false);
  });

  it("draws the book as a grid of cards, and rare and epic cards are visibly marked", async () => {
    const renderer = await createImageRenderer({ assetsDir: REAL_ASSETS });
    const twelve = CARDS.slice(0, 12);
    const png = await renderer.pack(twelve);
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect(size(png).width).toBe(Math.round(906 * 1.2));
    expect(size(png).height).toBeGreaterThan(400);
    // The same twelve cards without rarity marks must look different.
    const plain = await renderer.pack(
      twelve.map((c) => ({ ...c, rarity: "common" as const })),
    );
    const marked = await renderer.pack(
      twelve.map((c, i) => ({
        ...c,
        rarity:
          i < 2
            ? ("epic" as const)
            : i < 4
              ? ("rare" as const)
              : ("common" as const),
      })),
    );
    expect(marked.equals(plain)).toBe(false);
    expect(png.length).toBeLessThan(3 * 1024 * 1024);
  });
});

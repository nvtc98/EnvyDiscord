import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';

const EXTENSIONS = ['png', 'webp', 'jpg', 'jpeg'];
/** Decoded art is downscaled to this width so 15+ big images do not eat the NAS's RAM. */
const MAX_WIDTH = 640;

interface Entry {
  path: string;
  mtimeMs: number;
  canvas: Canvas;
}

/**
 * Loads `<dir>/<cardId>.(png|webp|jpg|jpeg)`. Files are re-read when they change on disk,
 * so dropping in new art does not need a bot restart. Cards without a file get `null`.
 */
export class ArtLibrary {
  private readonly cache = new Map<string, Entry>();
  private readonly warned = new Set<string>();

  constructor(
    private readonly dir: string,
    private readonly maxWidth = MAX_WIDTH,
  ) {}

  async get(cardId: string): Promise<Canvas | null> {
    for (const ext of EXTENSIONS) {
      const path = join(this.dir, `${cardId}.${ext}`);
      let mtimeMs: number;
      try {
        mtimeMs = (await stat(path)).mtimeMs;
      } catch {
        continue;
      }

      const cached = this.cache.get(cardId);
      if (cached && cached.path === path && cached.mtimeMs === mtimeMs) return cached.canvas;

      try {
        const image = await loadImage(path);
        const scale = Math.min(1, this.maxWidth / image.width);
        const canvas = createCanvas(Math.round(image.width * scale), Math.round(image.height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        this.cache.set(cardId, { path, mtimeMs, canvas });
        this.warned.delete(path);
        return canvas;
      } catch (error) {
        if (!this.warned.has(path)) {
          this.warned.add(path);
          console.warn(`Could not load card art ${path}: ${(error as Error).message}`);
        }
        this.cache.delete(cardId);
        return null;
      }
    }
    this.cache.delete(cardId);
    return null;
  }
}

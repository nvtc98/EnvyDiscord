import { join } from 'node:path';
import type { Canvas } from '@napi-rs/canvas';
import { ArtLibrary } from './art';

/**
 * Card frames: transparent PNG/WebP files `assets/frames/tier-<n>.png`. A tier without its own file uses the
 * nearest lower tier that has one, so a single `tier-1.png` is enough to start. `null` means no frame file exists
 * and the caller draws the built-in frame instead.
 */
export class FrameLibrary {
  private readonly files: ArtLibrary;

  constructor(framesDir: string) {
    this.files = new ArtLibrary(join(framesDir), 760); // keep the full resolution of a 750 px export
  }

  async forTier(tier: number): Promise<Canvas | null> {
    for (let t = Math.max(1, tier); t >= 1; t--) {
      const frame = await this.files.get(`tier-${t}`);
      if (frame) return frame;
    }
    return null;
  }
}

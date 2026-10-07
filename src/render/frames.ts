import { join } from "node:path";
import type { Canvas } from "@napi-rs/canvas";
import {
  DEFAULT_VARIANT,
  variantOrder,
  type VariantId,
} from "../data/variants";
import type { Faction } from "../engine/types";
import { ArtLibrary } from "./art";

/**
 * Card frames: transparent PNG/WebP files `assets/frames/variant-<id>.png`, one per variant. A variant without
 * its own file falls back to `variant-metal.png`, then to any other variant file in registry order, so a single
 * frame is enough to start. `null` means no frame file exists at all and the caller draws the built-in frame.
 */
export class FrameLibrary {
  private readonly files: ArtLibrary;

  constructor(framesDir: string) {
    this.files = new ArtLibrary(join(framesDir), 760); // keep the full resolution of a 750 px export
  }

  /** The frame for a card: Bò Tuôi has a single frame (variant ignored); The Eyes uses the variant path. */
  async forCard(faction: Faction, variant: VariantId): Promise<Canvas | null> {
    if (faction === "botuoi") return this.files.get("botuoi/frame");
    return this.forVariant(variant);
  }

  async forVariant(id: VariantId): Promise<Canvas | null> {
    // Try the requested variant, then metal, then any other variant file in registry order.
    const order = [id, DEFAULT_VARIANT, ...variantOrder()];
    const tried = new Set<VariantId>();
    for (const variant of order) {
      if (tried.has(variant)) continue;
      tried.add(variant);
      const frame = await this.files.get(`variant-${variant}`);
      if (frame) return frame;
    }
    return null;
  }
}

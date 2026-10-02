import { AttachmentBuilder } from 'discord.js';
import type { ImageRenderer } from '../render/renderer';
import type { AppContext } from './command';

/**
 * Renders an image if image support is on. Any failure (bad art file, native error) is logged
 * and returns null so the caller falls back to text instead of breaking the command.
 */
export async function tryRender(
  ctx: AppContext,
  make: (renderer: ImageRenderer) => Promise<Buffer>,
): Promise<Buffer | null> {
  if (!ctx.images) return null;
  try {
    return await make(ctx.images);
  } catch (error) {
    console.warn('Image rendering failed, falling back to text:', error);
    return null;
  }
}

/** A fresh file name per render keeps Discord from showing a cached older image. */
export const attach = (image: Buffer, name: string) => new AttachmentBuilder(image, { name });

import type { Assets } from '../assets';
import { normalizePath } from '../assets';
import { entryProperties } from '../formats/rpk';
import type { EnginePart } from '../engine/world';

export interface PartPaint { from: string; to: string }
export async function partPaint(part: EnginePart, assets: Assets): Promise<PartPaint | undefined> {
  const id = part.definition.config.texture;
  if (id === undefined) return;
  const source = async (pack: string, id: number) => entryProperties((await assets.resource(pack, id)).entry)
    .find(property => property.key === 'sourcefile')?.value;
  const from = await source(part.definition.key.pack, id);
  if (!from) return;
  const override = part.paintTexture;
  const to = override ? await source(override.pack, override.id) : from;
  return to ? { from, to } : undefined;
}
/** 00522b00 replaces the first matching material link, preserving other layers. */
export function partPaintTextures(textures: string[], paint?: PartPaint): string[] {
  if (!paint) return textures;
  const index = textures.findIndex(path => normalizePath(path) === normalizePath(paint.from));
  if (index < 0) return textures;
  const result = [...textures]; result[index] = paint.to; return result;
}

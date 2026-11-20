import {DataTexture,RGBAFormat,SRGBColorSpace,RepeatWrapping} from 'three';
import type { Assets } from '../assets';
import { normalizePath, resourceTextureSource } from '../assets';
import type { EnginePart } from '../engine/world';

export interface PartPaint { from: string; to: string; color?:number }
export async function partPaint(part: EnginePart, assets: Assets): Promise<PartPaint | undefined> {
  const id = part.definition.config.texture;
  if (id === undefined) return;
  const source = (pack: string, id: number) => resourceTextureSource(assets, { pack, id });
  const from = await source(part.definition.key.pack, id);
  if (!from) return;
  if(part.paintColor!==undefined)return {from,to:from,color:part.paintColor};
  const override = part.paintTexture;
  // Older host saves wrote session-local texture numbers without their source
  // path. Keep the vehicle loadable using its authored material in that case.
  if (override?.pack === '__runtime/legacy-textures.rpk' || override?.pack === '__runtime/textures.rpk' && !assets.runtimeTextureSource(override.id))
    return { from, to: from };
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

/** Opaque spray-paint fill, confined to the authored paint texture slot. */
export function solidPartPaint(color:number){
  const texture=new DataTexture(new Uint8Array([(color>>>16)&255,(color>>>8)&255,color&255,255]),1,1,RGBAFormat);
  texture.colorSpace=SRGBColorSpace;texture.wrapS=texture.wrapT=RepeatWrapping;texture.needsUpdate=true;return texture;
}

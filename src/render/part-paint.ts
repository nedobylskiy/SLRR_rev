import {DataTexture,RGBAFormat,SRGBColorSpace,RepeatWrapping} from 'three';
import type { Assets } from '../assets';
import { normalizePath } from '../assets';
import { entryProperties } from '../formats/rpk';
import type { EnginePart } from '../engine/world';

export interface PartPaint { from: string; to: string; color?:number }
export async function partPaint(part: EnginePart, assets: Assets): Promise<PartPaint | undefined> {
  const id = part.definition.config.texture;
  if (id === undefined) return;
  const source = async (pack: string, id: number) => entryProperties((await assets.resource(pack, id)).entry)
    .find(property => property.key === 'sourcefile')?.value;
  const from = await source(part.definition.key.pack, id);
  if (!from) return;
  if(part.paintColor!==undefined)return {from,to:from,color:part.paintColor};
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

/** Opaque spray-paint fill, confined to the authored paint texture slot. */
export function solidPartPaint(color:number){
  const texture=new DataTexture(new Uint8Array([(color>>>16)&255,(color>>>8)&255,color&255,255]),1,1,RGBAFormat);
  texture.colorSpace=SRGBColorSpace;texture.wrapS=texture.wrapT=RepeatWrapping;texture.needsUpdate=true;return texture;
}

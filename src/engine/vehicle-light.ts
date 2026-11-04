import type { Assets } from '../assets';
import { entryProperties } from '../formats/rpk';
import type { Triple } from '../formats/cfg';

export interface VehicleLight {
  texture: string; color: Triple; alpha: number;
  position: Triple; direction: Triple; cone: number; size: number; offset: number;
  textureMode?: number;
}

/** Type 13 lamp resources are lights, not external SCX meshes. Colors are A,R,G,B. */
export async function vehicleLight(assets: Assets, pack: string, id: number): Promise<VehicleLight | undefined> {
  const resource = await assets.resource(pack, id);
  if (resource.entry.type !== 13) return;
  const fields = new Map(entryProperties(resource.entry).map(property => [property.key, property.value]));
  const textureId = fields.get('lf_texture');
  if (!textureId) return;
  const texture = await assets.resource(resource.packPath, Number(textureId));
  const path = entryProperties(texture.entry).find(property => property.key === 'sourcefile')?.value;
  if (!path) return;
  const numbers = (name: string, fallback: number[]) => fields.has(name) ? fields.get(name)!.split(/\s+/).map(Number) : fallback;
  // Stock reverse lamps retain a red lf_glow_color but select color type 2:
  // their halo follows the light's diffuse color (white for reversing lamps).
  const colorType = numbers('lf_glow_colortype', [0])[0];
  const [alpha, ...color] = colorType === 2
    ? numbers('diffuse', [1, 1, 1, 1]) : numbers('lf_glow_color', [1, 1, 1, 1]);
  const position = numbers('position', [0, 0, 0]), direction = numbers('direction', [0, 0, -1]);
  const size = numbers('lf_glow_maxsize', [10])[0], offset = numbers('lf_glow_offset', [0])[0], cone = numbers('phi', [Math.PI])[0];
  if (color.length !== 3 || position.length !== 3 || direction.length !== 3 ||
      [...color, ...position, ...direction, alpha, size, offset, cone].some(value => !Number.isFinite(value)))
    throw new Error(`Invalid vehicle light ${resource.packPath}:${id}`);
  return { texture: path, color: color as Triple, alpha, position: position as Triple,
    ...(fields.has('lf_texturemode') ? { textureMode: Number(fields.get('lf_texturemode')) } : {}),
    direction: direction as Triple, cone, size, offset };
}

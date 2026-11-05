import { entryProperties, parseProperties, type RpkEntry, type RpkPack } from '../formats/rpk';
import type { ScxModel } from '../formats/scx';
import type { CfgPose } from '../formats/cfg';

/** Stock City exports its coarse collision shell as a child render resource too.
 * Keep loading it for terrain/collision, but never submit it as visible scenery.
 * This is an identified stock asset, not a general rule for untextured meshes.
 */
export function isStockMapCollisionShell(packPath:string,meshPath:string,alias:string,model:ScxModel):boolean {
  const normalize=(path:string)=>path.replaceAll('\\','/').toLowerCase();
  return normalize(packPath)==='maps/city.rpk' && normalize(meshPath)==='maps/city/meshes/c1_phys.scx'
    && alias.toLowerCase()==='c1_phys' && model.version===3 && model.meshes.length>0
    && model.meshes.every(mesh=>mesh.name==='_picsasag' && mesh.textureIndex===0xffff
      && (mesh.layer2Index===undefined||mesh.layer2Index===0xffff));
}

/** A direct mesh can also be the root of an outdoor map's render tree. */
export function groundRenderHasChildren(pack: RpkPack, renderId: number): boolean {
  return pack.entries.some(entry => entry.type === 14 && entry.superId === renderId);
}

/** Empty roots (ROC) select the outdoor resource tree, not an isolated room. */
export function groundRenderIsRoom(pack: RpkPack, renderId: number, model: ScxModel): boolean {
  return !groundRenderHasChildren(pack, renderId) && model.meshes.some(mesh => mesh.indices.length > 0);
}

/** Ground instances retain their script payload in a length-prefixed trailing RSD chunk. */
export function groundRenderDefinition(entry: RpkEntry): { gameType: number; renderId: number; pose: CfgPose } | undefined {
  if (entry.type !== 1) return;
  const bytes = entry.data;
  for (let offset = bytes.length - 8; offset >= 0; offset--) {
    if (bytes[offset] !== 82 || bytes[offset + 1] !== 83 || bytes[offset + 2] !== 68 || bytes[offset + 3] !== 0) continue;
    const size = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0, true);
    if (offset + 8 + size !== bytes.length) continue;
    const properties = parseProperties(new TextDecoder('windows-1252').decode(bytes.subarray(offset + 8)));
    const gameType = properties.find(property => property.key === 'gametype')?.value;
    const params = properties.find(property => property.key === 'params')?.value.split(',').map(value => value.trim());
    if (!gameType || !/^0x[0-9a-f]+$/i.test(gameType) || !params || ![1, 7].includes(params.length) || !/^0x[0-9a-f]+$/i.test(params[0])) return;
    const pose = params.length === 1 ? [0, 0, 0, 0, 0, 0] : params.slice(1).map(Number);
    if (!pose.every(Number.isFinite)) throw new Error('Ground RSD has a non-finite pose');
    return { gameType: Number(gameType), renderId: Number(params[0]),
      pose: { position: pose.slice(0, 3) as CfgPose['position'], rotation: pose.slice(3) as CfgPose['rotation'] } };
  }
}

/** Render resources belonging to a map. The SCX vertices already contain map-space positions. */
export function mapRenderIds(pack: RpkPack): number[] {
  const byId = new Map(pack.entries.map(entry => [entry.typeId, entry]));
  const parents = new Set(pack.entries.filter(entry => entry.type === 14).map(entry => entry.superId));
  return pack.entries.filter(entry => entry.type === 14 && (byId.get(entry.superId)?.type === 14 || parents.has(entry.typeId)) && entryProperties(entry).some(prop =>
    prop.key === 'mesh' && /^0x[0-9a-f]+$/i.test(prop.value) && byId.get(Number.parseInt(prop.value.slice(2), 16))?.type === 5
  )).map(entry => entry.typeId);
}

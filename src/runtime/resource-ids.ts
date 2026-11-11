import { normalizePath, normalizeResourcePackPath } from '../assets';
import type { RpkPack } from '../formats/rpk';
import type { ResourceIdentity } from 'slrr-jvm';

/** A live object's pack is authoritative; the high word is a caller-local namespace. */
export function instanceResourceIdentity(node: {typeId:number;resourcePack:string|null}, resolve:(id:number)=>ResourceIdentity|undefined):ResourceIdentity|undefined {
  if(node.resourcePack)return {pack:normalizeResourcePackPath(node.resourcePack),id:node.typeId&0xffff};
  const identity=resolve(node.typeId);
  return identity?{pack:normalizeResourcePackPath(identity.pack),id:identity.id}:undefined;
}

/** Encode a source resource literal using the owning pack's dependency slot. */
export function packedResourceId(owner: RpkPack, resource: ResourceIdentity): number | undefined {
  if (!Number.isInteger(resource.id) || resource.id < 0 || resource.id > 0xffff) return;
  const target = normalizePath(resource.pack.replace(/\.rpk$/i, '').replaceAll('.', '/') + '.rpk');
  const dependency = owner.dependencies.find(entry => normalizePath(entry.path) === target);
  if (!dependency) return;
  return ((dependency.id & 0xffff0000) | resource.id) | 0;
}

import { normalizePath } from '../assets';
import type { RpkPack } from '../formats/rpk';
import type { ResourceIdentity } from 'slrr-jvm';

/** Encode a source resource literal using the owning pack's dependency slot. */
export function packedResourceId(owner: RpkPack, resource: ResourceIdentity): number | undefined {
  if (!Number.isInteger(resource.id) || resource.id < 0 || resource.id > 0xffff) return;
  const target = normalizePath(resource.pack.replace(/\.rpk$/i, '').replaceAll('.', '/') + '.rpk');
  const dependency = owner.dependencies.find(entry => normalizePath(entry.path) === target);
  if (!dependency) return;
  return ((dependency.id & 0xffff0000) | resource.id) | 0;
}

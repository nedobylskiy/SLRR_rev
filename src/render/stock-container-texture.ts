import type { Assets } from '../assets';
import type { ScxMesh } from '../formats/scx';

const originalPath = /(?:^|[/\\])maps[/\\]textures[/\\]kontener\.dds$/i;
const oldPath = 'maps/textures/kontenertext1.dds';
const goldenHash = '02a6d10f03ca73371300b8774d803c2760e5814c8e9585d88c10a0a07740ef58';
const oldHash = '2bb7a6c5d0cd151f33d1f38f14a888f1838b8bfdda4aabe98309750e14a7a27f';
const oldTextureCache = new WeakMap<Assets, Promise<Uint8Array | undefined>>();

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function meshFingerprint(mesh: ScxMesh): number {
  let hash = 0x811c9dc5;
  for (const array of [mesh.positions, mesh.normals, mesh.uv, mesh.indices]) {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash;
}

/** The installed stock texture has a different atlas layout from its unchanged SCX mesh. */
export async function stockContainerTexture(mesh: ScxMesh, path: string, bytes: Uint8Array, assets: Assets) {
  if (!originalPath.test(path) || mesh.name !== 'KONTENER02' || meshFingerprint(mesh) !== 0x08858e8d) return { path, bytes };
  if (await sha256(bytes) !== goldenHash || !assets.byPath.has(oldPath)) return { path, bytes };
  let cached = oldTextureCache.get(assets);
  if (!cached) {
    cached = assets.read(oldPath).then(async oldBytes => await sha256(oldBytes) === oldHash ? oldBytes : undefined);
    oldTextureCache.set(assets, cached);
  }
  const oldBytes = await cached;
  if (!oldBytes) return { path, bytes };
  return { path: oldPath, bytes: oldBytes };
}

import { Assets, normalizePath } from '../assets';
import { parseTrc, type RoadNetwork } from '../formats/trc';

const caches = new WeakMap<Assets, Map<string, Promise<RoadNetwork>>>();
/** Prefer the selected ground's explicit road path; never substitute another city's graph. */
export async function loadMapRoads(assets: Assets, packPath: string, groundId?: number): Promise<{ path: string; network: RoadNetwork } | undefined> {
  const pack = await assets.pack(packPath);
  const entries = groundId === undefined ? pack.entries.filter(e => e.type === 1) : pack.entries.filter(e => e.typeId === groundId);
  const declared = new Set<string>();
  for (const entry of entries) {
    const text = new TextDecoder('windows-1252').decode(entry.data);
    for (const match of text.matchAll(/maps[\\/][^\s,\x00";]+\.trc/gi)) declared.add(normalizePath(match[0]));
  }
  const paths = [...declared];
  // Direct map preview has no selected ground. Allow one unambiguous local AI file.
  if (!paths.length && groundId === undefined) {
    const prefix = normalizePath(packPath).replace(/\.rpk$/, '/ai/');
    paths.push(...[...assets.byPath.keys()].filter(path => path.startsWith(prefix) && path.endsWith('.trc')));
  }
  if (!paths.length) return;
  if (paths.length !== 1) throw Error('Multiple road graphs: select a ground resource first');
  const path = paths[0];
  let cache = caches.get(assets); if (!cache) caches.set(assets, cache = new Map());
  let pending = cache.get(path);
  if (!pending) { pending = assets.read(path).then(parseTrc); cache.set(path, pending); pending.catch(() => cache!.delete(path)); }
  return { path, network: await pending };
}

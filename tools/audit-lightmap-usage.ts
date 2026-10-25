import { readFile } from 'node:fs/promises';
import { Assets, normalizePath } from '../src/assets';
import { entryProperties, parseRdb } from '../src/formats/rpk';
import { parseScx } from '../src/formats/scx';
import { gameRoot, relativeGamePath, safeGamePath, walk } from './game-files';

const paths = (await walk(gameRoot)).map(relativeGamePath);
const assets = new Assets(paths.map(path => ({ path, size: 0 })), async path => new Uint8Array(await readFile(await safeGamePath(path))));
const textures = await assets.pack('maps/textures.rpk');
const lightmaps = textures.entries.flatMap(entry => {
  const path = entryProperties(entry).find(p => p.key === 'sourcefile')?.value;
  return path && /lightmap/i.test(path) ? [{ id: entry.typeId, path }] : [];
});
const byPath = new Map(lightmaps.map(item => [normalizePath(item.path), item]));
const usages = new Map<string, { pack: string; alias: string; texture: string; origin: string }>();
const warnings: string[] = [];
for (const path of paths.filter(path => /\.rpk$/i.test(path))) {
  let pack;
  try { pack = await assets.pack(path); }
  catch (error) { warnings.push(`${path}: ${String(error)}`); continue; }
  const check = async (alias: string, values: string[], origin: string) => {
    for (const value of values) {
      if (!/^0x[0-9a-f]+$/i.test(value)) continue;
      try {
        const resource = await assets.resource(path, Number.parseInt(value.slice(2), 16));
        const source = entryProperties(resource.entry).find(p => p.key === 'sourcefile')?.value;
        const match = source && byPath.get(normalizePath(source));
        if (match) usages.set(`${path}|${alias}|${match.id}|${origin}`, { pack: path, alias, texture: match.path, origin });
      } catch { /* Broken unrelated resource refs do not prevent the inventory. */ }
    }
  };
  for (const entry of pack.entries) await check(entry.alias, entryProperties(entry).filter(p => p.key === 'texture').map(p => p.value), 'RPK');
  const rdbPath = path.replace(/\.rpk$/i, '.rdb');
  if (!assets.byPath.has(normalizePath(rdbPath))) continue;
  try {
    const files = parseRdb(new TextDecoder('windows-1252').decode(await assets.read(rdbPath)));
    for (const file of files.filter(file => /\.rsd$/i.test(file.name))) await check(file.name, file.properties.filter(p => p.key === 'texture').map(p => p.value), 'RDB');
  } catch (error) { warnings.push(`${rdbPath}: ${String(error)}`); }
}
const materialHits: { resource: string; mesh: string; material: string; texture: string; slot: string; channel: number }[] = [];
for (const usage of usages.values()) {
  if (usage.origin !== 'RPK') continue;
  try {
    const pack = await assets.pack(usage.pack), entry = pack.entries.find(entry => entry.alias === usage.alias && entry.type === 14);
    if (!entry) continue;
    const model = await assets.modelForResource(usage.pack, entry.typeId);
    const meshes = parseScx(await assets.read(model.path)).meshes;
    for (const material of meshes) {
      for (const [slot, index, channel] of [['primary', material.textureIndex, material.textureChannel ?? 0], ['second', material.layer2Index, material.layer2Channel ?? 0], ['lightmap', material.lightmapIndex, material.lightmapMap?.channel ?? 0], ['selfIllum', material.selfIllumIndex, material.selfIllumMap?.channel ?? 0]] as const) {
        const path = model.textures[index ?? -1];
        if (path && normalizePath(path) === normalizePath(usage.texture))
          materialHits.push({ resource: usage.alias, mesh: model.path, material: material.name, texture: path, slot, channel });
      }
    }
  } catch (error) { warnings.push(`${usage.pack}:${usage.alias}: ${String(error)}`); }
}
console.log(JSON.stringify({ lightmaps, usages: [...usages.values()].filter(usage => usage.origin === 'RPK'), materialHits, warnings }, null, 2));

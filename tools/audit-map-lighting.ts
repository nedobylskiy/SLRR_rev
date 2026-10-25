import { readFile } from 'node:fs/promises';
import { Assets } from '../src/assets';
import { mapRenderIds } from '../src/engine/map';
import { mapObjectPlacements, parseIcfg } from '../src/engine/map-objects';
import { parseScx } from '../src/formats/scx';
import { parseRdb } from '../src/formats/rpk';
import { gameRoot, relativeGamePath, safeGamePath, walk } from './game-files';

const packPath = process.argv[2] ?? 'maps/test_track.rpk';
const assets = new Assets((await walk(gameRoot)).map(path => ({ path: relativeGamePath(path), size: 0 })),
  async path => new Uint8Array(await readFile(await safeGamePath(path))));
const pack = await assets.pack(packPath);
const rdbPath = packPath.replace(/\.rpk$/i, '.rdb');
const rdb = parseRdb(new TextDecoder('windows-1252').decode(await assets.read(rdbPath)));
const shadowKeys = new Map<string, { count: number; nonzero: number }>();
for (const entry of rdb) for (const property of entry.properties.filter(p => /^shd_/i.test(p.key))) {
  const stat = shadowKeys.get(property.key) ?? { count: 0, nonzero: 0 };
  stat.count++;
  if (property.value.split(/[\s,]+/).some(v => Number(v) !== 0)) stat.nonzero++;
  shadowKeys.set(property.key, stat);
}
const materialSamples: object[] = [], texturePaths = new Map<string, number>(), lightingMaps: object[] = [];
let models = 0, materials = 0, uv2Materials = 0, uv3Materials = 0, activeUv3Materials = 0;
const primaryChannels = new Map<number, number>(), secondaryChannels = new Map<number, number>();
for (const id of mapRenderIds(pack)) {
  const model = await assets.modelForResource(packPath, id);
  const scx = parseScx(await assets.read(model.path)); models++;
  for (const part of scx.meshes) {
    materials++;
    if (part.uv2) uv2Materials++;
    if (part.uv3) uv3Materials++;
    if (part.uv3?.some(v => Math.abs(v) > 1e-6)) activeUv3Materials++;
    if (model.textures[part.textureIndex]) primaryChannels.set(part.textureChannel ?? 0, (primaryChannels.get(part.textureChannel ?? 0) ?? 0) + 1);
    if (model.textures[part.layer2Index ?? -1]) secondaryChannels.set(part.layer2Channel ?? 0, (secondaryChannels.get(part.layer2Channel ?? 0) ?? 0) + 1);
    for (const index of [part.textureIndex, part.layer2Index, part.lightmapIndex, part.selfIllumIndex]) {
      const path = model.textures[index ?? -1];
      if (path) texturePaths.set(path, (texturePaths.get(path) ?? 0) + 1);
    }
    for (const [kind, index] of [['lightmap', part.lightmapIndex], ['selfIllum', part.selfIllumIndex]] as const) {
      const path = model.textures[index ?? -1];
      if (path) lightingMaps.push({ kind, model: model.path, material: part.name, path });
    }
    const layer = model.textures[part.layer2Index ?? -1];
    if (/(?:lightmap|shadow|shad)/i.test(layer ?? '') || part.uv3 && materialSamples.length < 12)
      materialSamples.push({ model: model.path, material: part.name, primary: model.textures[part.textureIndex], layer, uv2: !!part.uv2, uv3: !!part.uv3, textureChannel: part.textureChannel, layer2Channel: part.layer2Channel });
  }
}
const suspiciousTextures = [...texturePaths].filter(([path]) => /(?:lightmap|shadow|shad)/i.test(path));
const objectTextures = new Map<string, number>(), objectWarnings: string[] = [], objectLightingMaps: object[] = [];
let objectTypes = 0, objectMaterials = 0;
for (const typeId of new Set(mapObjectPlacements(new TextDecoder('windows-1252').decode(await assets.read(rdbPath)), pack).map(p => p.typeId))) {
  try {
    const resource = await assets.resource(packPath, typeId);
    if (resource.entry.type !== 8) continue;
    const cfg = parseIcfg(resource.entry.data);
    let model: Awaited<ReturnType<Assets['modelForResource']>> | undefined;
    for (const render of cfg.renders) {
      try { model = await assets.modelForResource(resource.packPath, render.resource); break; }
      catch { /* Abstract LOD resource before the concrete mesh. */ }
    }
    if (!model) continue;
    objectTypes++;
    for (const part of parseScx(await assets.read(model.path)).meshes) {
      objectMaterials++;
      for (const index of [part.textureIndex, part.layer2Index, part.lightmapIndex, part.selfIllumIndex]) {
        const path = model.textures[index ?? -1];
        if (path) objectTextures.set(path, (objectTextures.get(path) ?? 0) + 1);
      }
      for (const [kind, index] of [['lightmap', part.lightmapIndex], ['selfIllum', part.selfIllumIndex]] as const) {
        const path = model.textures[index ?? -1];
        if (path) objectLightingMaps.push({ kind, model: model.path, material: part.name, path });
      }
    }
  } catch (error) { objectWarnings.push(`0x${typeId.toString(16)}: ${String(error)}`); }
}
console.log(JSON.stringify({ packPath, dependencies: pack.dependencies.map(d => d.path), renderModels: models, materials, uv2Materials, uv3Materials, activeUv3Materials,
  primaryChannels: Object.fromEntries(primaryChannels), secondaryChannels: Object.fromEntries(secondaryChannels),
  shadowKeys: Object.fromEntries(shadowKeys), suspiciousTextures, lightingMaps, objectTypes, objectMaterials,
  suspiciousObjectTextures: [...objectTextures].filter(([path]) => /(?:lightmap|shadow|shad)/i.test(path)), objectLightingMaps, objectWarnings,
  materialSamples: materialSamples.slice(0, 20) }, null, 2));

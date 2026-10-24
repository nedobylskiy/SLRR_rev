import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseRdb, parseRpk, entryProperties } from '../src/formats/rpk';
import { parseScx } from '../src/formats/scx';

const game = process.argv[2] ?? 'C:/Program Files (x86)/Steam/steamapps/common/Street Legal Racing Redline';
const mapName = process.argv[3] ?? 'test_track';
const mapPath = resolve(game, 'maps', mapName);
const pack = parseRpk(new Uint8Array(readFileSync(`${mapPath}.rpk`)));
const source = parseRdb(readFileSync(`${mapPath}.rdb`, 'utf8'));
const sourceObjects = source.filter(file => file.name.toLowerCase().endsWith('.res') &&
  file.properties.some(prop => prop.key === 'typeof' && prop.value === '1'));
const meshResources = pack.entries.filter(entry => entry.type === 5).flatMap(entry =>
  entryProperties(entry).filter(prop => prop.key === 'sourcefile').map(prop => ({ id: entry.typeId, alias: entry.alias, path: prop.value })));
const physicalCandidates = meshResources.filter(resource => /(?:^|[\\/])[^\\/]*_phys\.scx$/i.test(resource.path));
const materialOnly = meshResources.filter(resource => /\.scy$/i.test(resource.path)).flatMap(resource => {
  const path = resolve(game, resource.path.replaceAll('\\', '/'));
  if (!existsSync(path)) return [{ ...resource, result: 'missing' }];
  try {
    const parsed = parseScx(new Uint8Array(readFileSync(path)));
    return [{ ...resource, result: `${parsed.meshes.reduce((n, mesh) => n + mesh.indices.length / 3, 0)} triangles` }];
  } catch (error) { return [{ ...resource, result: String(error) }]; }
});
const hasSignature = (signature: string) => pack.entries.some(entry => Buffer.from(entry.data).includes(signature));
const missingDependencies = pack.dependencies.filter(dep => !existsSync(resolve(game, dep.path))).map(dep => dep.path);

console.log(JSON.stringify({
  map: mapName,
  compiled: { resources: pack.entries.length, gameObjects: pack.entries.filter(entry => entry.type === 1).length,
    renderResources: pack.entries.filter(entry => entry.type === 14).length, meshResources: meshResources.length },
  source: { gameObjects: sourceObjects.length, gameObjectsAbsentFromCompiledPack:
    sourceObjects.filter(file => !pack.entries.some(entry => entry.type === 1 && entry.typeId === Number.parseInt(file.name, 16))).length },
  physicalCandidates, materialOnly, signatures: { PHYS: hasSignature('PHYS'), POLY: hasSignature('POLY') },
  missingDependencies,
}, null, 2));

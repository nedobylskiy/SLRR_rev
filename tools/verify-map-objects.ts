import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { Assets } from '../src/assets';
import { parseScx } from '../src/formats/scx';
import { mapObjectPlacements, parseIcfg } from '../src/engine/map-objects';
import { MapCollision } from '../src/engine/map-collision';
import { poseMatrix } from '../src/engine/transforms';
import { Vector3 } from 'three';

const game = process.argv[2] ?? 'C:/Program Files (x86)/Steam/steamapps/common/Street Legal Racing Redline';
const files = readdirSync(game, { recursive: true, withFileTypes: true }).filter(file => file.isFile()).map(file => {
  const full = resolve(file.parentPath, file.name);
  return { path: relative(game, full).replaceAll('\\', '/'), size: 0 };
});
const assets = new Assets(files, async path => new Uint8Array(readFileSync(resolve(game, path))));
const packPath = 'maps/test_track.rpk', pack = await assets.pack(packPath);
const placements = mapObjectPlacements(readFileSync(resolve(game, 'maps/test_track.rdb'), 'utf8'), pack);
const types = [...new Set(placements.map(placement => placement.typeId))];
let resolved = 0;
const collision = new MapCollision();
for (const typeId of types) {
  const { packPath: owner, entry } = await assets.resource(packPath, typeId);
  const cfg = parseIcfg(entry.data);
  let model = '';
  for (const render of cfg.renders) {
    try { model = (await assets.modelForResource(owner, render.resource)).path; break; } catch { /* abstract LOD */ }
  }
  if (!model) throw new Error(`No visible model for ${entry.alias} (0x${typeId.toString(16)})`);
  const instances = placements.filter(placement => placement.typeId === typeId);
  for (const instance of instances) for (const body of cfg.bodies) {
    if (body.collision === false || body.shape[0]?.toLowerCase() !== 'box') continue;
    const half = body.shape.slice(1, 4).map(Number);
    if (half.length === 3) collision.addBox(poseMatrix(instance.pose).multiply(poseMatrix(body)), new Vector3(half[0], half[1], half[2]));
  }
  resolved += instances.length;
  console.log(`${entry.alias}: ${instances.length} × ${model}`);
}
const containers = placements.filter(placement => placement.typeId === 0x00060527);
if (containers.length !== 80 || resolved !== placements.length) throw new Error(`Incomplete map objects: ${resolved}/${placements.length}, containers ${containers.length}`);
const first = containers[0].pose.position;
if (!collision.contact(new Vector3(first[0] + 2.8, first[1], first[2]))) throw new Error('Container CFG box does not collide');
const containerModel = await assets.modelForResource('objects.rpk', 0x522);
const containerMaterial = parseScx(await assets.read(containerModel.path)).meshes[0];
if (containerMaterial.textureIndex !== 0 || !/maps[/\\]textures[/\\]kontener\.dds$/i.test(containerModel.textures[0] ?? '')) {
  throw new Error('Container SCX material did not resolve its original RPK texture');
}
await assets.read(containerModel.textures[containerMaterial.textureIndex]);
console.log(`Resolved ${resolved} Test Track objects, including ${containers.length} containers and ${collision.boxes} original CFG boxes`);

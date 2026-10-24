import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Box3, Matrix4, Vector3 } from 'three';
import { Assets } from '../src/assets';
import { PartFactory, poseMatrix, type EnginePart } from '../src/engine/world';
import { parseScx } from '../src/formats/scx';
import { modelMatrix } from '../src/engine/model-transform';
import { CarCrashDemo } from '../src/engine/car-crash-demo';
import { PartHost, PART_CLASS } from '../src/engine/part-host';
import { gameRoot, walk, relativeGamePath, safeGamePath } from './game-files';

const assets = new Assets((await walk(gameRoot)).map(f => ({ path: relativeGamePath(f), size: 0 })), async p => new Uint8Array(await readFile(await safeGamePath(p))));
const load = async (part: EnginePart) => {
  const model = parseScx(await assets.read(part.definition.model!.path));
  const transform = modelMatrix(new Matrix4(), part.definition.config.renderPose && poseMatrix(part.definition.config.renderPose));
  return model.meshes.flatMap(m => { const out: number[] = []; for (let i = 0; i < m.positions.length; i += 3) out.push(...new Vector3().fromArray(m.positions, i).applyMatrix4(transform).toArray()); return out; });
};
const results = [];
let roofDrop: { contacts: number; peakUpward: number; supportedY: number; finalMeanY: number; roofY: number } | undefined;
for (const [speed, miss] of [[0, false], [10 / 3.6, false], [50 / 3.6, false], [50 / 3.6, true]] as const) {
  const { world, root, warnings } = await new PartFactory(assets).stock({ pack: 'cars/racers/Baiern.rpk', id: 6 });
  assert.deepEqual(warnings, []);
  const hood = [...world.parts.values()].find(p => /\/hood.cfg$/i.test(p.definition.cfgPath))!, slot = hood.parentSlot!, id = hood.id, count = world.parts.size;
  const body = await load(root), bounds = new Box3(); for (let i = 0; i < body.length; i += 3) bounds.expandByPoint(new Vector3().fromArray(body, i));
  const demo = new CarCrashDemo(root, hood, await load(hood), bounds); demo.reset(speed);
  const triangles: number[] = [], inverseRoot = root.matrix().invert();
  for (const part of world.parts.values()) {
    if (part === hood || !part.definition.model) continue;
    const type = part.parent?.definition.config.slots.find(s => s.id === part.parentSlot)?.type;
    if (type === 11 || type !== undefined && type >= 101 && type < 200) continue;
    const model = parseScx(await assets.read(part.definition.model.path)), transform = modelMatrix(inverseRoot.clone().multiply(part.matrix()), part.definition.config.renderPose && poseMatrix(part.definition.config.renderPose));
    for (const mesh of model.meshes) for (const index of mesh.indices) triangles.push(...new Vector3().fromArray(mesh.positions, index * 3).applyMatrix4(transform).toArray());
  }
  demo.setBodyTriangles(triangles);
  const host = new PartHost(world), handle = host.bind(hood);
  if (miss) { demo.obstacle.min[0] += 10; demo.obstacle.max[0] += 10; }
  let detachedAt = -1, hasMovingMass = false;
  for (let i = 0; i < 240 * 6; i++) {
    demo.advance(1 / 240, { throttle: 0, steer: 0, brake: false });
    if (i === 24 && speed > 0) { const mean = demo.panel.velocities.filter((_, j) => j % 3 === 2).reduce((a, b) => a + b, 0) / (demo.panel.velocities.length / 3); assert.ok(mean < -speed * 0.8, 'Hood must carry vehicle momentum before contact'); hasMovingMass = true; }
    if (!hood.parent && detachedAt < 0) detachedAt = i / 240;
    assert.ok(demo.panel.positions.every(Number.isFinite)); assert.ok(hood.matrix().elements.every(Number.isFinite));
  }
  const broken = demo.panel.mounts.filter(m => m.broken).length;
  assert.equal(world.parts.size, count); assert.equal(world.parts.get(id), hood);
  if (speed === 0 || miss) { assert.equal(broken, 0); assert.equal(demo.panel.plasticBeams, 0); assert.equal(demo.impactSpeed, 0); }
  else if (speed < 5) { assert.equal(broken, 0); assert.ok(demo.panel.plasticBeams > 0); assert.equal(root.children.get(slot), hood); }
  else {
    assert.equal(broken, 3); assert.equal(hood.parent, undefined); assert.equal(root.children.has(slot), false); assert.ok(detachedAt > 0);
    assert.equal(host.natives.invoke(PART_CLASS, 'partOnSlot', '(I)Ljava.game.parts.Part;', host.bind(root), [slot]), null);
    assert.equal(host.natives.invoke(PART_CLASS, 'getSlotID', '(I)I', handle, [-1]), 0);
    const detached = hood.matrix().clone(), carBefore = demo.driving.position.clone();
    for (let i = 0; i < 240; i++) demo.advance(1 / 240, { throttle: -1, steer: 0, brake: false });
    const carTravel = demo.driving.position.distanceTo(carBefore), hoodTravel = new Vector3().setFromMatrixPosition(hood.matrix()).distanceTo(new Vector3().setFromMatrixPosition(detached));
    assert.ok(carTravel > 2); assert.ok(Number.isFinite(hoodTravel)); assert.equal(hood.parent, undefined);
    // Contact may physically carry the hood with the car. A parent transform must never do so directly.
    const carPose = root.local.clone(), freePose = hood.matrix().clone(), nodes = demo.panel.positions.slice();
    root.local.premultiply(new Matrix4().makeTranslation(2, 0, 0)); assert.deepEqual(hood.matrix(), freePose); assert.deepEqual(demo.panel.positions, nodes); root.local.copy(carPose);
  }
  results.push({ launchKmh: speed * 3.6, miss, impactKmh: demo.impactSpeed * 3.6, reboundKmh: demo.reboundSpeed * 3.6, bodyContacts: demo.bodySurface!.hits, collisionTriangles: triangles.length / 9, broken, plasticBeams: demo.panel.plasticBeams, detachedAt, hasMovingMass, worldParts: count, detachedPose: hood.matrix().elements.slice(12, 15) });
  demo.reset(); assert.equal(root.children.get(slot), hood); assert.equal(hood.id, id); assert.equal(world.parts.size, count); assert.equal(demo.panel.plasticBeams, 0); assert.equal(demo.panel.mounts.filter(m => m.broken).length, 0);
  assert.equal(host.bind(hood), handle);
  if (speed === 0) {
    demo.dropOnRoof(); let peakUpward = 0, supportedY = 0;
    for (let i = 0; i < 240 * 6; i++) { demo.advance(1 / 240, { throttle: 0, steer: 0, brake: false }); if (demo.bodySurface!.hits) peakUpward = Math.max(peakUpward, demo.panel.velocities.filter((_, a) => a % 3 === 1).reduce((a, b) => a + b, 0) / (demo.panel.velocities.length / 3)); if (i === 240) supportedY = demo.panel.positions.filter((_, a) => a % 3 === 1).reduce((a, b) => a + b, 0) / (demo.panel.positions.length / 3); }
    const meanY = demo.panel.positions.filter((_, a) => a % 3 === 1).reduce((a, b) => a + b, 0) / (demo.panel.positions.length / 3);
    roofDrop = { contacts: demo.bodySurface!.hits, peakUpward, supportedY, finalMeanY: meanY, roofY: demo.bodySurface!.roofPoint().applyMatrix4(root.matrix()).y };
    assert.ok(demo.bodySurface!.hits > 0); assert.ok(peakUpward > 0.05); assert.ok(supportedY > demo.bodySurface!.roofPoint().applyMatrix4(root.matrix()).y - 0.1);
  }
  demo.dispose(); host.dispose(); world.dispose();
}
await mkdir('local', { recursive: true }); await writeFile('local/crash-verification.json', JSON.stringify({ scenarios: results, roofDrop }, null, 2)); console.log(JSON.stringify({ scenarios: results, roofDrop }, null, 2));
